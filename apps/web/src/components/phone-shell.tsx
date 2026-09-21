import { cn } from "@/lib/cn";
import { PhoneStatusBar } from "@/components/phone-status-bar";

export function PhoneShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-[#EEF3FF] p-0 sm:items-center sm:p-4 md:p-8">
      <div
        className={cn(
          "relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white",
          "sm:h-[844px] sm:max-h-[calc(100dvh-2rem)] sm:w-[390px] sm:rounded-[32px] sm:shadow-phone",
          className,
        )}
      >
        <PhoneStatusBar />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </main>
  );
}
