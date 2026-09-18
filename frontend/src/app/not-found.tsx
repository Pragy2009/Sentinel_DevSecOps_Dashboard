import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-sn-bg flex flex-col items-center justify-center gap-3">
      <div className="text-[28px] font-bold text-sn-text font-mono">404</div>
      <div className="text-[13px] text-sn-dim">This page could not be found.</div>
      <Link
        href="/dashboard"
        className="mt-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[12px] font-medium transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
