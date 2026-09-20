"use client";

import { NotificationCenter } from "@/components/notification-center";
import { PhoneShell } from "@/components/phone-shell";

/**
 * PC-3.1e — `/notifications`, the standalone Notification Center.
 *
 * A sub-screen of the Messages hub (the hub keeps its five-row preview and links
 * here), so it uses `ScreenHeader` and no tab bar, exactly like the other
 * `/me/*` sub-screens.
 */
export default function NotificationsPage() {
  return (
    <PhoneShell>
      <NotificationCenter />
    </PhoneShell>
  );
}
