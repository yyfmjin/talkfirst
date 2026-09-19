import { redirect } from "next/navigation";

/**
 * Phase B1: the dashboard moved to `/dashboard`, matching the rest of the
 * console's route names (`/users`, `/reports`, `/audit`).
 *
 * `/` stays as a permanent redirect rather than being deleted: the login screen
 * still lands here (`router.replace("/")`), and so does the shared
 * `loginAndLand()` test helper, which asserts the 「仪表盘」 heading appears
 * after signing in. Removing this route would break both.
 */
export default function RootPage() {
  redirect("/dashboard");
}
