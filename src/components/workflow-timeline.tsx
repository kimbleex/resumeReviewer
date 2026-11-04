"use client";

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Play, X } from "lucide-react";

import { REVIEW_STAGE_ORDER as STAGE_ORDER } from "@/lib/review/stages";
import {
  EMPTY_STAGE_LIVE_STATE,
  STAGE_META,
  formatWorkflowStatus,
  type StageLiveState,
  type StageName,
  type StageStatus,
} from "@/components/review-studio-shared";
import { getReviewCallCheckpoint } from "@/lib/review/schemas";
import { getReviewDisplayPayloads } from "@/lib/review/scoring";
import { WorkflowNodeInsight } from "@/components/workflow-node-insight";

function isStageReadyToRun(stage: StageName, stagePayloads: Partial<Record<StageName, unknown>>): boolean {
  if (stage === "resume_loader") {
    return true;
  }
  if (stage === "resume_parser") {
    return Boolean(stagePayloads.resume_loader);
  }
  const parallelReviewers: StageName[] = ["hr_agent", "interviewer_agent", "career_master_agent"];
  if (parallelReviewers.includes(stage)) {
    return Boolean(stagePayloads.resume_parser);
  }
  if (stage === "summary_agent") {
    return Boolean(
      stagePayloads.hr_agent &&
      stagePayloads.interviewer_agent &&
      stagePayloads.career_master_agent &&
      ![stagePayloads.hr_agent, stagePayloads.interviewer_agent, stagePayloads.career_master_agent].some(getReviewCallCheckpoint)
    );
  }
  if (stage === "rewrite_agent") {
    return Boolean(stagePayloads.summary_agent && !getReviewCallCheckpoint(stagePayloads.summary_agent));
  }
  return false;
}

const FlowRunnerPath = memo(function FlowRunnerPath({
  path,
  lineClass,
  duration = "2.4s",
  delay = "0s",
}: {
  path: string;
  lineClass: string;
  duration?: string;
  delay?: string;
}) {
  const runnerClass =
    lineClass === "flow-line-done"
      ? "flow-line-runner flow-line-runner-done"
      : lineClass === "flow-line-active"
        ? "flow-line-runner flow-line-runner-active"
        : lineClass === "flow-line-ready"
          ? "flow-line-runner flow-line-runner-ready"
          : "flow-line-runner";

  return (
    <path
      d={path}
      className={`${lineClass} ${runnerClass}`}
      fill="none"
      vectorEffect="non-scaling-stroke"
      style={{ animationDelay: delay, animationDuration: duration }}
    />
  );
});

const WorkflowDownArrow = memo(function WorkflowDownArrow({
  isDone,
  isRunning,
  isReady,
}: {
  isDone: boolean;
  isRunning: boolean;
  isReady: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, fromY: 278, toX: 100, toY: 160 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const loaderCard = parent.querySelector('.workflow-node-resume_loader');
      const parserCard = parent.querySelector('.workflow-node-resume_parser');
      const rect = parent.getBoundingClientRect();
      if (loaderCard && parserCard && rect.width > 0) {
        const lRect = loaderCard.getBoundingClientRect();
        const pRect = parserCard.getBoundingClientRect();
        setPorts({
          fromX: lRect.right - rect.left,
          fromY: (lRect.top + lRect.height / 2) - rect.top,
          toX: pRect.left - rect.left,
          toY: (pRect.top + pRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      const loader = flowParent.querySelector('.workflow-node-resume_loader');
      if (loader) ro.observe(loader);
      const parser = flowParent.querySelector('.workflow-node-resume_parser');
      if (parser) ro.observe(parser);
    }
    update();
    return () => ro.disconnect();
  }, []);

  const lineClass = isDone ? "flow-line-done" : isRunning ? "flow-line-active" : isReady ? "flow-line-ready" : "flow-line-idle";

  const fx = ports.fromX;
  const fy = ports.fromY;
  const tx = ports.toX;
  const ty = ports.toY;
  const cx = (fx + tx) / 2; // center X for vertical segment
  const r = 12;
  const path = Math.abs(fy - ty) < 4
    ? `M ${fx} ${fy} H ${tx}`
    : `M ${fx} ${fy} H ${cx - r} Q ${cx} ${fy} ${cx} ${fy > ty ? fy - r : fy + r} V ${fy > ty ? ty + r : ty - r} Q ${cx} ${ty} ${cx + r} ${ty} H ${tx}`;

  const arrowColor =
    isDone ? "var(--green)" : (isRunning || isReady) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  return (
    <div className="flowchart-arrow-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={path} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={path} className={lineClass} fill="none" />
        <FlowRunnerPath path={path} lineClass={lineClass} duration="1.45s" />
        <path
          d={`M ${tx - 6} ${ty - 5} L ${tx} ${ty} L ${tx - 6} ${ty + 5}`}
          stroke={arrowColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
});

const WorkflowVerticalArrow = memo(function WorkflowVerticalArrow({
  fromSelector,
  toSelector,
  isDone,
  isRunning,
  isReady,
}: {
  fromSelector: string;
  toSelector: string;
  isDone: boolean;
  isRunning: boolean;
  isReady: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ cx: 24, fromY: -8, toY: 58 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const flowParent = el.closest('.workflow-flowchart');
      const prev = flowParent?.querySelector(fromSelector);
      const next = flowParent?.querySelector(toSelector);
      const rect = flowParent?.getBoundingClientRect();
      if (prev && next && rect && rect.height > 0) {
        const prevRect = prev.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        setPorts({
          cx: (nextRect.left + nextRect.width / 2) - rect.left,
          fromY: prevRect.bottom - rect.top,
          toY: nextRect.top - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      const prev = flowParent.querySelector(fromSelector);
      const next = flowParent.querySelector(toSelector);
      if (prev) ro.observe(prev);
      if (next) ro.observe(next);
    }
    update();
    return () => ro.disconnect();
  }, [fromSelector, toSelector]);

  const lineClass = isDone ? "flow-line-done" : isRunning ? "flow-line-active" : isReady ? "flow-line-ready" : "flow-line-idle";
  const { cx, fromY, toY } = ports;
  const path = `M ${cx} ${fromY} V ${toY}`;

  return (
    <div className="flowchart-vertical-arrow-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <defs>
          <marker id="arrow-down-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-down-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
          <marker id="arrow-down-gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 2 2 L 6 5 L 2 8" stroke="rgba(0, 242, 254, 0.38)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </marker>
        </defs>
        <path d={path} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" />
        <path d={path} className={lineClass} markerEnd={isDone ? "url(#arrow-down-green)" : (isRunning || isReady) ? "url(#arrow-down-cyan)" : "url(#arrow-down-gray)"} />
        <FlowRunnerPath path={path} lineClass={lineClass} duration="1.45s" />
      </svg>
    </div>
  );
});


/** Input 区的连线：Resume → Target Job（同一行横向），Target Job → Loader（折线回到第一列）。 */
const WorkflowInputConnector = memo(function WorkflowInputConnector({
  hasResume,
  isInputReady,
  loaderStatus,
}: {
  hasResume: boolean;
  isInputReady: boolean;
  loaderStatus: StageStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ resumeRight: 0, targetLeft: 0, rowY: 0, targetX: 0, targetBottom: 0, loaderX: 0, loaderTop: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const selectors = ['.workflow-resume-card', '.workflow-target-card', '.workflow-node-resume_loader'];
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      const rect = parent?.getBoundingClientRect();
      const [resume, target, loader] = selectors.map((sel) => parent?.querySelector(sel)?.getBoundingClientRect());
      if (!rect || rect.width === 0 || !resume || !target || !loader) return;
      setPorts({
        resumeRight: resume.right - rect.left,
        targetLeft: target.left - rect.left,
        rowY: resume.top + resume.height / 2 - rect.top,
        targetX: target.left + target.width / 2 - rect.left,
        targetBottom: target.bottom - rect.top,
        loaderX: loader.left + loader.width / 2 - rect.left,
        loaderTop: loader.top - rect.top,
      });
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      for (const sel of selectors) {
        const node = flowParent.querySelector(sel);
        if (node) ro.observe(node);
      }
    }
    update();
    return () => ro.disconnect();
  }, []);

  const linkClass = isInputReady ? "flow-line-done" : hasResume ? "flow-line-ready" : "flow-line-idle";
  const feedClass =
    loaderStatus === "done" ? "flow-line-done" : loaderStatus === "running" ? "flow-line-active" : isInputReady ? "flow-line-ready" : "flow-line-idle";
  const arrowColor = (lineClass: string) =>
    lineClass === "flow-line-done" ? "var(--green)" : lineClass === "flow-line-idle" ? "rgba(0, 242, 254, 0.38)" : "var(--cyan)";

  const { resumeRight, targetLeft, rowY, targetX, targetBottom, loaderX, loaderTop } = ports;
  const linkPath = `M ${resumeRight} ${rowY} H ${targetLeft}`;
  // 从 Target Job 底部下行到两行之间的空隙，再左转回到 Loader 正上方
  const midY = targetBottom + (loaderTop - targetBottom) / 2;
  const r = Math.max(0, Math.min(12, (loaderTop - targetBottom) / 4, Math.abs(targetX - loaderX) / 2));
  const feedPath =
    `M ${targetX} ${targetBottom} V ${midY - r} Q ${targetX} ${midY} ${targetX - r} ${midY} ` +
    `H ${loaderX + r} Q ${loaderX} ${midY} ${loaderX} ${midY + r} V ${loaderTop}`;

  return (
    <div className="flowchart-vertical-arrow-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={linkPath} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" />
        <path d={linkPath} className={linkClass} />
        <FlowRunnerPath path={linkPath} lineClass={linkClass} duration="1.2s" />
        <path
          d={`M ${targetLeft - 6} ${rowY - 5} L ${targetLeft} ${rowY} L ${targetLeft - 6} ${rowY + 5}`}
          stroke={arrowColor(linkClass)}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={feedPath} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" />
        <path d={feedPath} className={feedClass} />
        <FlowRunnerPath path={feedPath} lineClass={feedClass} duration="2.2s" />
        <path
          d={`M ${loaderX - 5} ${loaderTop - 6} L ${loaderX} ${loaderTop} L ${loaderX + 5} ${loaderTop - 6}`}
          stroke={arrowColor(feedClass)}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});


const WorkflowBranchConnector = memo(function WorkflowBranchConnector({
  isParserDone,
  hrStatus,
  interviewerStatus,
  careerStatus,
}: {
  isParserDone: boolean;
  hrStatus: StageStatus;
  interviewerStatus: StageStatus;
  careerStatus: StageStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, fromY: 160, toX: 100, topY: 42, midY: 160, bottomY: 278 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const parserCard = parent.querySelector('.workflow-node-resume_parser');
      const hrCard = parent.querySelector('.workflow-node-hr_agent');
      const interviewerCard = parent.querySelector('.workflow-node-interviewer_agent');
      const careerCard = parent.querySelector('.workflow-node-career_master_agent');
      const rect = parent.getBoundingClientRect();
      if (parserCard && hrCard && interviewerCard && careerCard && rect.width > 0) {
        const pRect = parserCard.getBoundingClientRect();
        const hRect = hrCard.getBoundingClientRect();
        const iRect = interviewerCard.getBoundingClientRect();
        const cRect = careerCard.getBoundingClientRect();
        setPorts({
          fromX: pRect.right - rect.left,
          fromY: (pRect.top + pRect.height / 2) - rect.top,
          toX: Math.min(hRect.left, iRect.left, cRect.left) - rect.left,
          topY: (hRect.top + hRect.height / 2) - rect.top,
          midY: (iRect.top + iRect.height / 2) - rect.top,
          bottomY: (cRect.top + cRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      for (const sel of ['.workflow-node-resume_parser', '.workflow-node-hr_agent', '.workflow-node-interviewer_agent', '.workflow-node-career_master_agent']) {
        const n = flowParent.querySelector(sel);
        if (n) ro.observe(n);
      }
    }
    update();
    return () => ro.disconnect();
  }, []);

  const readyClass = isParserDone ? "flow-line-ready" : "flow-line-idle";
  const getBranchClass = (status: StageStatus) =>
    status === "done" ? "flow-line-done" : status === "running" ? "flow-line-active" : readyClass;

  const leftClass = getBranchClass(hrStatus);
  const midClass = getBranchClass(interviewerStatus);
  const rightClass = getBranchClass(careerStatus);

  const allReviewersDone = hrStatus === "done" && interviewerStatus === "done" && careerStatus === "done";
  const anyReviewerRunning = hrStatus === "running" || interviewerStatus === "running" || careerStatus === "running";
  const trunkClass = allReviewersDone
    ? "flow-line-done"
    : anyReviewerRunning
      ? "flow-line-active"
      : isParserDone
        ? "flow-line-ready"
        : "flow-line-idle";

  const fx = ports.fromX;
  const fy = ports.fromY;
  const tx = ports.toX;
  const ty1 = ports.topY;
  const ty2 = ports.midY;
  const ty3 = ports.bottomY;
  const cx = (fx + tx) / 2;
  const r = 12;

  const buildBranchPath = (ty: number) => {
    if (Math.abs(ty - fy) < 8) {
      return `M ${cx - r} ${fy} H ${tx}`;
    }
    const sign = ty < fy ? -1 : 1;
    const startCornerY = fy + sign * r;
    const endCornerY = ty - sign * r;
    return `M ${cx - r} ${fy} Q ${cx} ${fy} ${cx} ${startCornerY} V ${endCornerY} Q ${cx} ${ty} ${cx + r} ${ty} H ${tx}`;
  };

  const pathTrunk = `M ${fx} ${fy} H ${cx - r}`;
  const pathTop = buildBranchPath(ty1);
  const pathMid = buildBranchPath(ty2);
  const pathBottom = buildBranchPath(ty3);

  const arrowColor = (status: StageStatus, ready: boolean) =>
    status === "done" ? "var(--green)" : (status === "running" || ready) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  const chevron = (y: number, color: string) => (
    <path d={`M ${tx - 6} ${y - 5} L ${tx} ${y} L ${tx - 6} ${y + 5}`} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );

  return (
    <div className="flowchart-branch-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={pathTrunk} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathTop} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathMid} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathBottom} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />

        <path d={pathTrunk} className={trunkClass} fill="none" />
        <path d={pathTop} className={leftClass} fill="none" />
        <path d={pathMid} className={midClass} fill="none" />
        <path d={pathBottom} className={rightClass} fill="none" />
        <FlowRunnerPath path={pathTrunk} lineClass={trunkClass} duration="1.75s" />
        <FlowRunnerPath path={pathTop} lineClass={leftClass} duration="2.15s" delay="-0.35s" />
        <FlowRunnerPath path={pathMid} lineClass={midClass} duration="1.65s" delay="-0.1s" />
        <FlowRunnerPath path={pathBottom} lineClass={rightClass} duration="2.15s" delay="-0.75s" />

        {chevron(ty1, arrowColor(hrStatus, isParserDone))}
        {chevron(ty2, arrowColor(interviewerStatus, isParserDone))}
        {chevron(ty3, arrowColor(careerStatus, isParserDone))}
      </svg>
    </div>
  );
});

const WorkflowMergeConnector = memo(function WorkflowMergeConnector({
  hrStatus,
  interviewerStatus,
  careerStatus,
  summaryStatus,
}: {
  hrStatus: StageStatus;
  interviewerStatus: StageStatus;
  careerStatus: StageStatus;
  summaryStatus: StageStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ports, setPorts] = useState({ fromX: -14, topY: 42, midY: 160, bottomY: 278, toX: 100, toY: 42 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const parent = el.closest('.workflow-flowchart');
      if (!parent) return;
      const hrCard = parent.querySelector('.workflow-node-hr_agent');
      const interviewerCard = parent.querySelector('.workflow-node-interviewer_agent');
      const careerCard = parent.querySelector('.workflow-node-career_master_agent');
      const summaryCard = parent.querySelector('.workflow-node-summary_agent');
      const rect = parent.getBoundingClientRect();
      if (hrCard && interviewerCard && careerCard && summaryCard && rect.width > 0) {
        const hRect = hrCard.getBoundingClientRect();
        const iRect = interviewerCard.getBoundingClientRect();
        const cRect = careerCard.getBoundingClientRect();
        const sRect = summaryCard.getBoundingClientRect();
        setPorts({
          fromX: Math.max(hRect.right, iRect.right, cRect.right) - rect.left,
          topY: (hRect.top + hRect.height / 2) - rect.top,
          midY: (iRect.top + iRect.height / 2) - rect.top,
          bottomY: (cRect.top + cRect.height / 2) - rect.top,
          toX: sRect.left - rect.left,
          toY: (sRect.top + sRect.height / 2) - rect.top,
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    const flowParent = el.closest('.workflow-flowchart');
    if (flowParent) {
      ro.observe(flowParent);
      for (const sel of ['.workflow-node-hr_agent', '.workflow-node-interviewer_agent', '.workflow-node-career_master_agent', '.workflow-node-summary_agent']) {
        const n = flowParent.querySelector(sel);
        if (n) ro.observe(n);
      }
    }
    update();
    return () => ro.disconnect();
  }, []);

  const allReviewersDone = hrStatus === "done" && interviewerStatus === "done" && careerStatus === "done";
  const readyToSummarize = allReviewersDone && summaryStatus === "pending";
  const pendingClass = readyToSummarize ? "flow-line-ready" : "flow-line-idle";
  const getMergeClass = (status: StageStatus) =>
    summaryStatus === "done"
      ? "flow-line-done"
      : summaryStatus === "running"
        ? "flow-line-active"
        : status === "done"
          ? "flow-line-done"
          : pendingClass;

  const leftClass = getMergeClass(hrStatus);
  const midClass = getMergeClass(interviewerStatus);
  const rightClass = getMergeClass(careerStatus);

  const trunkClass = summaryStatus === "done"
    ? "flow-line-done"
    : summaryStatus === "running"
      ? "flow-line-active"
      : allReviewersDone
        ? "flow-line-ready"
        : "flow-line-idle";

  const fx = ports.fromX;
  const tx = ports.toX;
  const ty1 = ports.topY;
  const ty2 = ports.midY;
  const ty3 = ports.bottomY;
  const toY = ports.toY;
  const cx = (fx + tx) / 2;
  const r = 12;

  const buildBranchPath = (ty: number) => {
    if (Math.abs(ty - toY) < 8) {
      return `M ${fx} ${ty} H ${cx + r}`;
    }
    const sign = ty > toY ? -1 : 1;
    const startCornerY = ty + sign * r;
    const endCornerY = toY - sign * r;
    return `M ${fx} ${ty} H ${cx - r} Q ${cx} ${ty} ${cx} ${startCornerY} V ${endCornerY} Q ${cx} ${toY} ${cx + r} ${toY}`;
  };

  const pathTop = buildBranchPath(ty1);
  const pathMid = buildBranchPath(ty2);
  const pathBottom = buildBranchPath(ty3);
  const pathTrunk = `M ${cx + r} ${toY} H ${tx}`;

  const arrowColor =
    summaryStatus === "done" ? "var(--green)" : (summaryStatus === "running" || allReviewersDone) ? "var(--cyan)" : "rgba(0, 242, 254, 0.38)";

  return (
    <div className="flowchart-merge-container" ref={containerRef}>
      <svg width="100%" height="100%" fill="none" style={{ overflow: "visible" }}>
        <path d={pathTop} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathMid} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathBottom} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />
        <path d={pathTrunk} stroke="rgba(255, 255, 255, 0.04)" strokeWidth="1.5" fill="none" />

        <path d={pathTop} className={leftClass} fill="none" />
        <path d={pathMid} className={midClass} fill="none" />
        <path d={pathBottom} className={rightClass} fill="none" />
        <path d={pathTrunk} className={trunkClass} fill="none" />
        <FlowRunnerPath path={pathTop} lineClass={leftClass} duration="2.15s" delay="-0.2s" />
        <FlowRunnerPath path={pathMid} lineClass={midClass} duration="1.65s" delay="-0.55s" />
        <FlowRunnerPath path={pathBottom} lineClass={rightClass} duration="2.15s" delay="-0.9s" />
        <FlowRunnerPath path={pathTrunk} lineClass={trunkClass} duration="1.75s" />

        <path
          d={`M ${tx - 6} ${toY - 5} L ${tx} ${toY} L ${tx - 6} ${toY + 5}`}
          stroke={arrowColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
});

const StageWorkflowCard = memo(function StageWorkflowCard({
  stage,
  index,
  isSelected,
  payload,
  status,
  liveState,
  onOpenStageDetails,
  onStartStage,
  onInterrupt,
  isRunningAny,
  isReady,
}: {
  stage: StageName;
  index: number;
  isSelected: boolean;
  payload: unknown;
  status: StageStatus;
  liveState: StageLiveState;
  onOpenStageDetails: (stage: StageName) => void;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
  isReady: boolean;
}) {
  const meta = STAGE_META[stage];
  const statusLabel = formatWorkflowStatus(status, liveState.phase);
  const hasResult = Boolean(payload);

  return (
    <div
      className={`workflow-node-card workflow-node-${stage} workflow-node-${status} ${isSelected ? "is-selected" : ""} ${hasResult ? "has-result" : ""}`}
      onClick={() => onOpenStageDetails(stage)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenStageDetails(stage);
        }
      }}
      aria-label={`打开 ${meta.label} 节点详情，当前状态：${statusLabel}`}
      aria-pressed={isSelected}
    >
      <span className="workflow-node-content">
        <span className="workflow-node-kicker">STEP 0{index + 1}</span>
        <strong>{meta.label}</strong>
        <span className="workflow-node-status-text">
          {status === "running" && liveState.latestMessage ? liveState.latestMessage : meta.focus}
        </span>
        <WorkflowNodeInsight stage={stage} payload={payload} />
      </span>
      <StageStatusIndicator
        stage={stage}
        status={status}
        label={statusLabel}
        onStartStage={onStartStage}
        onInterrupt={onInterrupt}
        isRunningAny={isRunningAny}
        isReady={isReady}
      />
    </div>
  );
});

function StageStatusIndicator({
  stage,
  status,
  label,
  onStartStage,
  onInterrupt,
  isRunningAny,
  isReady,
}: {
  stage: StageName;
  status: StageStatus;
  label: string;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
  isReady: boolean;
}) {
  if (status === "running") {
    return (
      <button
        className="workflow-node-status-indicator workflow-node-status-indicator-running interactive-status-btn"
        onClick={(e) => {
          e.stopPropagation();
          onInterrupt();
        }}
        aria-label="中断诊断"
        title="点击中断诊断"
        type="button"
      >
        <span className="indicator-running-container">
          <LoaderCircle className="spin-icon default-icon" size={15} aria-hidden="true" />
          <X className="stop-icon" size={15} aria-hidden="true" />
        </span>
      </button>
    );
  }

  // If the pipeline is not running and this stage is ready to be run, show Play icon on hover
  if (!isRunningAny && isReady) {
    const playTooltip = status === "pending" ? "启动该阶段诊断" : "重新启动该阶段诊断";
    return (
      <button
        className={`workflow-node-status-indicator workflow-node-status-indicator-${status} interactive-status-btn`}
        onClick={(e) => {
          e.stopPropagation();
          onStartStage(stage);
        }}
        aria-label={playTooltip}
        title={playTooltip}
        type="button"
      >
        <span className="indicator-play-container">
          <span className="default-icon flex items-center justify-center">
            {status === "done" && <CheckCircle2 size={15} aria-hidden="true" />}
            {(status === "interrupted" || status === "failed") && <AlertCircle size={15} aria-hidden="true" />}
            {status === "pending" && <span className="workflow-status-dot" aria-hidden="true" />}
          </span>
          <Play className="play-icon" size={11} fill="currentColor" aria-hidden="true" />
        </span>
      </button>
    );
  }

  if (status === "done") {
    return (
      <span
        className="workflow-node-status-indicator workflow-node-status-indicator-done"
        aria-label={label}
        title={label}
      >
        <CheckCircle2 size={15} aria-hidden="true" />
      </span>
    );
  }

  if (status === "interrupted" || status === "failed") {
    return (
      <span
        className={`workflow-node-status-indicator workflow-node-status-indicator-${status}`}
        aria-label={label}
        title={label}
      >
        <AlertCircle size={15} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className="workflow-node-status-indicator workflow-node-status-indicator-pending"
      aria-label={label}
      title={label}
    >
      <span className="workflow-status-dot" aria-hidden="true" />
    </span>
  );
}

type WorkflowTimelineProps = {
  setupNode: ReactNode;
  hasResume: boolean;
  isInputReady: boolean;
  selectedStage: StageName;
  stagePayloads: Partial<Record<StageName, unknown>>;
  stageStatus: Record<StageName, StageStatus>;
  stageStreams: Partial<Record<StageName, StageLiveState>>;
  onOpenStageDetails: (stage: StageName) => void;
  onStartStage: (stage: StageName) => void;
  onInterrupt: () => void;
  isRunningAny: boolean;
};

export const WorkflowTimeline = memo(function WorkflowTimeline({
  setupNode,
  hasResume,
  isInputReady,
  selectedStage,
  stagePayloads,
  stageStatus,
  stageStreams,
  onOpenStageDetails,
  onStartStage,
  onInterrupt,
  isRunningAny,
}: WorkflowTimelineProps) {
  const displayPayloads = useMemo(() => getReviewDisplayPayloads(stagePayloads), [stagePayloads]);
  const getLiveState = (stage: StageName) => stageStreams[stage] ?? EMPTY_STAGE_LIVE_STATE;
  const getStatus = (stage: StageName) => stageStatus[stage];
  const isReady = (stage: StageName) => isStageReadyToRun(stage, stagePayloads);

  return (
    <div className="workflow-flowchart" aria-label="Resume review workflow flowchart">
      {/* 1. Input: Resume (col 1) → Target Job (col 3), framed together */}
      <div className="workflow-setup-container workflow-entry-column">
        {setupNode}
      </div>

      {/* Resume → Target Job → Loader */}
      <div className="workflow-vertical-arrow-left">
        <WorkflowInputConnector
          hasResume={hasResume}
          isInputReady={isInputReady}
          loaderStatus={getStatus("resume_loader")}
        />
      </div>

      {/* 2. Resume Loader (bottom row, col 1) */}
      <div className="workflow-loader-container">
        <StageWorkflowCard
          stage="resume_loader"
          index={1}
          isSelected={selectedStage === "resume_loader"}
          payload={displayPayloads["resume_loader"]}
          status={getStatus("resume_loader")}
          liveState={getLiveState("resume_loader")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("resume_loader")}
        />
      </div>

      {/* Horizontal connector Loader -> Parser */}
      <div className="workflow-down-arrow-container">
        <WorkflowDownArrow
          isDone={getStatus("resume_parser") === "done"}
          isRunning={getStatus("resume_parser") === "running"}
          isReady={getStatus("resume_loader") === "done"}
        />
      </div>

      {/* 3. Resume Parser (bottom row, col 3) */}
      <div className="workflow-parser-container">
        <StageWorkflowCard
          stage="resume_parser"
          index={2}
          isSelected={selectedStage === "resume_parser"}
          payload={displayPayloads["resume_parser"]}
          status={getStatus("resume_parser")}
          liveState={getLiveState("resume_parser")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("resume_parser")}
        />
      </div>

      {/* Branch Parser -> Parallel Reviewer Agent */}
      <div className="workflow-branch-container">
        <WorkflowBranchConnector
          isParserDone={getStatus("resume_parser") === "done"}
          hrStatus={getStatus("hr_agent")}
          interviewerStatus={getStatus("interviewer_agent")}
          careerStatus={getStatus("career_master_agent")}
        />
      </div>

      {/* 4. Three Parallel Reviewers */}
      <div className="workflow-reviewer-row">
        <StageWorkflowCard
          stage="hr_agent"
          index={3}
          isSelected={selectedStage === "hr_agent"}
          payload={displayPayloads["hr_agent"]}
          status={getStatus("hr_agent")}
          liveState={getLiveState("hr_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("hr_agent")}
        />
        <StageWorkflowCard
          stage="interviewer_agent"
          index={4}
          isSelected={selectedStage === "interviewer_agent"}
          payload={displayPayloads["interviewer_agent"]}
          status={getStatus("interviewer_agent")}
          liveState={getLiveState("interviewer_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("interviewer_agent")}
        />
        <StageWorkflowCard
          stage="career_master_agent"
          index={5}
          isSelected={selectedStage === "career_master_agent"}
          payload={displayPayloads["career_master_agent"]}
          status={getStatus("career_master_agent")}
          liveState={getLiveState("career_master_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("career_master_agent")}
        />
      </div>

      {/* Merge Reviewer Agents -> Summary Agent */}
      <div className="workflow-merge-container">
        <WorkflowMergeConnector
          hrStatus={getStatus("hr_agent")}
          interviewerStatus={getStatus("interviewer_agent")}
          careerStatus={getStatus("career_master_agent")}
          summaryStatus={getStatus("summary_agent")}
        />
      </div>

      {/* 5. Summary Agent */}
      <div className="workflow-summary-container">
        <StageWorkflowCard
          stage="summary_agent"
          index={6}
          isSelected={selectedStage === "summary_agent"}
          payload={displayPayloads["summary_agent"]}
          status={getStatus("summary_agent")}
          liveState={getLiveState("summary_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("summary_agent")}
        />
      </div>

      {/* Vertical arrow from Summary to Rewrite */}
      <div className="workflow-vertical-arrow-right">
        <WorkflowVerticalArrow
          fromSelector=".workflow-node-summary_agent"
          toSelector=".workflow-node-rewrite_agent"
          isDone={getStatus("rewrite_agent") === "done"}
          isRunning={getStatus("rewrite_agent") === "running"}
          isReady={getStatus("summary_agent") === "done"}
        />
      </div>

      {/* 6. Resume Rewrite */}
      <div className="workflow-rewrite-container workflow-output-column">
        <StageWorkflowCard
          stage="rewrite_agent"
          index={7}
          isSelected={selectedStage === "rewrite_agent"}
          payload={displayPayloads["rewrite_agent"]}
          status={getStatus("rewrite_agent")}
          liveState={getLiveState("rewrite_agent")}
          onOpenStageDetails={onOpenStageDetails}
          onStartStage={onStartStage}
          onInterrupt={onInterrupt}
          isRunningAny={isRunningAny}
          isReady={isReady("rewrite_agent")}
        />
      </div>
    </div>
  );
}, areWorkflowTimelinePropsEqual);

function areWorkflowTimelinePropsEqual(previous: WorkflowTimelineProps, next: WorkflowTimelineProps) {
  if (previous.setupNode !== next.setupNode || previous.isInputReady !== next.isInputReady) {
    return false;
  }
  if (previous.selectedStage !== next.selectedStage) {
    return false;
  }
  if (previous.onOpenStageDetails !== next.onOpenStageDetails) {
    return false;
  }
  if (previous.onStartStage !== next.onStartStage) {
    return false;
  }
  if (previous.onInterrupt !== next.onInterrupt) {
    return false;
  }
  if (previous.isRunningAny !== next.isRunningAny) {
    return false;
  }

  return STAGE_ORDER.every((stage) => {
    const previousStream = previous.stageStreams[stage];
    const nextStream = next.stageStreams[stage];

    return (
      previous.stageStatus[stage] === next.stageStatus[stage] &&
      previous.stagePayloads[stage] === next.stagePayloads[stage] &&
      (previousStream?.phase ?? null) === (nextStream?.phase ?? null) &&
      (previousStream?.latestMessage ?? "") === (nextStream?.latestMessage ?? "")
    );
  });
}
