import { describe, expect, it } from "vitest";
import { PrivateMessagesLink } from "./private-messages-link";

describe("PrivateMessagesLink", () => {
  it("shows a calm letter when there is nothing unread", () => {
    const link = PrivateMessagesLink({ label: "Личка", unreadCount: 0 });
    expect(link.props.href).toBe("/notifications");
    expect(link.props.className).not.toContain("hasUnread");
    expect(link.props["data-has-unread"]).toBe(false);
  });

  it("activates the letter animation state when notifications are unread", () => {
    const link = PrivateMessagesLink({ label: "Личка", unreadCount: 2, current: true });
    expect(link.props.className).toContain("hasUnread");
    expect(link.props["data-has-unread"]).toBe(true);
    expect(link.props["aria-current"]).toBe("page");
  });
});
