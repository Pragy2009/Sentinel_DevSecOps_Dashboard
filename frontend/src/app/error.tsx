"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-sn-bg flex flex-col items-center justify-center gap-3 px-4">
      <div className="text-[16px] font-bold text-sn-text">Something went wrong</div>
      <div className="text-[12px] text-sn-dim font-mono max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </div>
      <button
        onClick={() => reset()}
        className="mt-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 rounded-lg text-white text-[12px] font-medium transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
