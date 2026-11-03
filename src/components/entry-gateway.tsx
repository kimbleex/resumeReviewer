"use client";

import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { ReviewStudio } from "@/components/review-studio";

export function EntryGateway() {
  const [hasEntered, setHasEntered] = useState(false);

  if (hasEntered) {
    return <ReviewStudio />;
  }

  return (
    <main className="entry-shell">
      <div className="intro-container">
        <span className="shimmer-eyebrow">RESUME DIAGNOSTIC CORE</span>
        <h1 className="shimmer-title">Mutil-Agent Resume Reviewer</h1>

        <button
          className="premium-cta-btn"
          onClick={() => setHasEntered(true)}
          type="button"
        >
          <Sparkles size={18} />
          尝试一下
          <ArrowRight size={18} />
        </button>
      </div>
    </main>
  );
}
