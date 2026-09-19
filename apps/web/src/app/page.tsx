import { LogoMark, Wordmark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { GradientButton } from "@/components/ui";

export default function WelcomePage() {
  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="relative h-[430px] shrink-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-[#C9D9FF] via-[#E7EEFF] to-white" />
          <svg className="absolute bottom-0 h-auto w-full" viewBox="0 0 390 220" fill="none" preserveAspectRatio="xMidYMax slice">
            <path d="M0 140 C70 90 120 170 190 110 C250 60 300 130 390 80 L390 220 L0 220Z" fill="#9BB6F0" />
            <path d="M0 170 C80 120 150 190 230 140 C300 100 340 160 390 130 L390 220 L0 220Z" fill="#7F9BE0" />
            <circle cx="300" cy="70" r="28" fill="#F7FBFF" opacity="0.9" />
          </svg>
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 pt-10">
            <LogoMark size={72} />
            <div className="mt-5">
              <Wordmark />
            </div>
          </div>
        </div>
        <div className="mt-auto px-8 pb-8 pt-8">
          <GradientButton href="/login">开始</GradientButton>
          <p className="mt-3 text-center text-[12px] text-muted">18+ only</p>
        </div>
      </div>
    </PhoneShell>
  );
}
