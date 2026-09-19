import { PhoneShell } from "@/components/phone-shell";
import { GradientButton } from "@/components/ui";

export default function CompletePage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-8 text-center">
        <div className="relative mb-6 h-40 w-40 shrink-0">
          <div className="absolute inset-0 rounded-full bg-indigo-50" />
          <div className="tf-gradient absolute left-1/2 top-8 grid h-20 w-20 -translate-x-1/2 place-items-center rounded-[24px] text-2xl text-white">
            ✦
          </div>
        </div>
        <h1 className="text-[22px] font-semibold leading-8">
          你已成功创建个人名片！
          <br />
          现在去发现有趣的人吧～
        </h1>
        <div className="mt-10 w-full">
          <GradientButton href="/discover">去发现</GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
