import { PhoneShell } from "@/components/phone-shell";
import { GradientButton } from "@/components/ui";

export default function RegisterSuccessPage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-8 text-center">
        <div className="tf-gradient grid h-20 w-20 shrink-0 place-items-center rounded-full text-3xl text-white shadow-lg shadow-indigo-200">
          ✓
        </div>
        <h1 className="mt-8 text-[28px] font-semibold">注册成功！</h1>
        <p className="mt-3 text-[14px] leading-6 text-muted">
          欢迎加入 TalkFirst，
          <br />
          现在去完善你的个人名片吧。
        </p>
        <div className="mt-10 w-full">
          <GradientButton href="/onboarding/avatar">去创建名片</GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
