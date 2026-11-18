import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const LINK_COMMAND = ["t3", "connect", "link", "--headless"];
export const LINK_STATUS_COMMAND = ["t3", "connect", "status", "--json"];

const LinkStatus = Schema.Struct({ desired: Schema.Boolean, authenticated: Schema.Boolean });
const decodeLinkStatus = Schema.decodeUnknownOption(Schema.fromJsonString(LinkStatus));

/**
 * `t3 connect link` exits 0 when the operator cancels the relay-client install, so the
 * runner trusts the server's own status instead of the exit code.
 */
export const isLinkAuthorized = (statusJson: string): boolean =>
  Option.match(decodeLinkStatus(statusJson.trim()), {
    onNone: () => false,
    onSome: (status) => status.desired && status.authenticated,
  });
