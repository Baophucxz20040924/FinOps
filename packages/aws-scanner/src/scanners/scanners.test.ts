import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import type { Logger } from "@infra-explorer/shared";
import { ApiCallRecorder } from "../api-recorder";
import type { ScanContext } from "../types";
import { Ec2Scanner } from "./ec2.scanner";
import { EbsScanner } from "./ebs.scanner";

const ec2Mock = mockClient(EC2Client);

function makeCtx(): { ctx: ScanContext; recorder: ApiCallRecorder } {
  const recorder = new ApiCallRecorder();
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  const ctx: ScanContext = {
    target: {
      accountId: "acc-uuid",
      awsAccountId: "123456789012",
      credentials: async () => ({
        accessKeyId: "x",
        secretAccessKey: "y",
      }),
    },
    region: "us-west-2",
    logger,
    recorder,
  };
  return { ctx, recorder };
}

beforeEach(() => {
  ec2Mock.reset();
});

describe("Ec2Scanner", () => {
  it("normalizes instances across paginated pages", async () => {
    ec2Mock
      .on(DescribeInstancesCommand)
      .resolvesOnce({
        Reservations: [
          {
            Instances: [
              {
                InstanceId: "i-1",
                InstanceType: "t3.large",
                State: { Name: "running" },
                VpcId: "vpc-1",
                SubnetId: "subnet-1",
                PublicIpAddress: "1.2.3.4",
                SecurityGroups: [{ GroupId: "sg-1" }],
                BlockDeviceMappings: [{ Ebs: { VolumeId: "vol-1" } }],
                Tags: [
                  { Key: "Name", Value: "api-prod" },
                  { Key: "Environment", Value: "prod" },
                ],
              },
            ],
          },
        ],
        NextToken: "p2",
      })
      .resolves({
        Reservations: [{ Instances: [{ InstanceId: "i-2", State: { Name: "stopped" } }] }],
      });

    const { ctx, recorder } = makeCtx();
    const result = await new Ec2Scanner().scan(ctx);

    expect(result.errors).toHaveLength(0);
    expect(result.resources).toHaveLength(2);
    expect(recorder.totalCalls).toBe(2);

    const first = result.resources[0]!;
    expect(first.service).toBe("EC2");
    expect(first.type).toBe("instance");
    expect(first.name).toBe("api-prod");
    expect(first.state).toBe("running");
    expect(first.environment).toBe("prod");
    expect(first.arn).toBe(
      "arn:aws:ec2:us-west-2:123456789012:instance/i-1",
    );
    expect(first.accountId).toBe("acc-uuid");
    expect(first.metadata.subnetId).toBe("subnet-1");
    expect(first.metadata.securityGroupIds).toEqual(["sg-1"]);
    expect(first.metadata.volumeIds).toEqual(["vol-1"]);
    expect(first.metadata.hasPublicIp).toBe(true);

    // second instance has no name tag -> falls back to id
    expect(result.resources[1]!.name).toBe("i-2");
  });

  it("returns a scanner error (not a throw) on a non-retryable failure", async () => {
    ec2Mock
      .on(DescribeInstancesCommand)
      .rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));

    const { ctx } = makeCtx();
    const result = await new Ec2Scanner().scan(ctx);

    expect(result.resources).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.service).toBe("EC2");
    expect(result.errors[0]!.throttled).toBe(false);
  });
});

describe("EbsScanner", () => {
  it("normalizes volumes and captures attachment + state", async () => {
    ec2Mock.on(DescribeVolumesCommand).resolves({
      Volumes: [
        {
          VolumeId: "vol-1",
          State: "available",
          Size: 100,
          VolumeType: "gp3",
          AvailabilityZone: "us-west-2a",
        },
        {
          VolumeId: "vol-2",
          State: "in-use",
          Size: 8,
          Attachments: [{ InstanceId: "i-1", Device: "/dev/xvda" }],
        },
      ],
    });

    const { ctx } = makeCtx();
    const result = await new EbsScanner().scan(ctx);

    expect(result.errors).toHaveLength(0);
    expect(result.resources).toHaveLength(2);

    const unattached = result.resources[0]!;
    expect(unattached.service).toBe("EBS");
    expect(unattached.state).toBe("available");
    expect(unattached.metadata.sizeGiB).toBe(100);
    expect(unattached.metadata.attachedInstanceIds).toEqual([]);

    const attached = result.resources[1]!;
    expect(attached.state).toBe("in-use");
    expect(attached.metadata.attachedInstanceIds).toEqual(["i-1"]);
  });
});
