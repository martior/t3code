import * as Schema from "effect/Schema";

/** Becomes part of container and volume names, so only lowercase DNS-label-like names. */
export const MemberName = Schema.String.check(
  Schema.isPattern(/^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/),
).pipe(Schema.brand("MemberName"));
export type MemberName = typeof MemberName.Type;

export const decodeMemberName = Schema.decodeUnknownEffect(MemberName);

export const MANAGED_LABEL = "codes.t3.runner.managed";
export const MEMBER_LABEL = "codes.t3.runner.member";

export const containerName = (member: MemberName) => `t3-runner-${member}`;
export const volumeName = (member: MemberName) => `t3-runner-${member}`;
export const networkName = (member: MemberName) => `t3-runner-${member}`;
