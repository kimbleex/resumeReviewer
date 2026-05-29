from pathlib import Path

from app.orchestrators.review_pipeline import ReviewPipeline
from app.schemas.review import (
    FinalResumeReview,
    ResumeDocument,
    ResumeProfile,
    ReviewRunResult,
    ReviewerFeedback,
    RevisionSuggestion,
)


class StubLoader:
    def load(self, path: Path) -> ResumeDocument:
        return ResumeDocument(
            path=path.resolve(),
            file_type="txt",
            content="Backend engineer with Python, LangChain, and system design experience.",
        )


class StubParserAgent:
    name = "resume_parser"

    def invoke(self, document: ResumeDocument) -> ResumeProfile:
        return ResumeProfile(
            candidate_name="Alex",
            headline="Backend engineer",
            target_roles=["AI Backend Engineer"],
            years_of_experience="5+ years",
            core_skills=["Python", "LangChain"],
            strengths=["Strong backend ownership"],
            risks=["Missing quantified impact"],
            missing_information=["Target industry"],
            reasoning_summary=["Extracted technical focus and noticed missing business metrics."],
        )


class StubReviewerAgent:
    def __init__(self, name: str, perspective: str) -> None:
        self.name = name
        self.perspective = perspective

    def invoke(self, payload: dict) -> ReviewerFeedback:
        return ReviewerFeedback(
            agent_name=self.name,
            perspective=self.perspective,
            overall_score=78,
            reasoning_summary=[f"{self.perspective} review focused on impact and clarity."],
            strengths=["Relevant project experience"],
            concerns=["Bullets need stronger outcomes"],
            suggestions=[
                RevisionSuggestion(
                    section="Experience",
                    priority="high",
                    issue="Bullets describe work but not outcomes.",
                    recommendation="Add metrics and measurable business impact.",
                    example_rewrite="Improved resume scoring workflow, cutting review turnaround by 35%.",
                )
            ],
        )


class StubSummaryAgent:
    name = "summary_agent"

    def invoke(self, payload: dict) -> FinalResumeReview:
        return FinalResumeReview(
            overall_score=82,
            ready_level="promising",
            executive_summary="The resume is technically credible but needs stronger positioning and quantified impact.",
            reasoning_summary=["Merged overlap across reviewer concerns and prioritized high-signal edits."],
            top_priorities=[
                "Quantify project impact in the experience section.",
                "Tighten the headline around target AI backend roles.",
            ],
            section_revisions=[
                RevisionSuggestion(
                    section="Summary",
                    priority="high",
                    issue="Headline is too generic.",
                    recommendation="Lead with AI/backend positioning and domain focus.",
                    example_rewrite="AI Backend Engineer building LangChain-based multi-agent systems for hiring workflows.",
                )
            ],
        )


class EventCollector:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def on_event(self, event) -> None:
        self.events.append((event.kind, event.stage))


def test_review_pipeline_runs_agents_in_expected_order(tmp_path: Path) -> None:
    collector = EventCollector()
    pipeline = ReviewPipeline(
        loader=StubLoader(),
        parser_agent=StubParserAgent(),
        reviewer_agents=[
            StubReviewerAgent("hr_agent", "HR"),
            StubReviewerAgent("interviewer_agent", "Interviewer"),
            StubReviewerAgent("career_master_agent", "Career Master"),
        ],
        summary_agent=StubSummaryAgent(),
    )

    result = pipeline.run(tmp_path / "resume.txt", event_handler=collector.on_event)

    assert isinstance(result, ReviewRunResult)
    assert result.final_review.overall_score == 82
    assert [feedback.agent_name for feedback in result.reviewer_feedback] == [
        "hr_agent",
        "interviewer_agent",
        "career_master_agent",
    ]
    assert collector.events == [
        ("stage_started", "resume_loader"),
        ("stage_completed", "resume_loader"),
        ("stage_started", "resume_parser"),
        ("stage_completed", "resume_parser"),
        ("stage_started", "hr_agent"),
        ("stage_completed", "hr_agent"),
        ("stage_started", "interviewer_agent"),
        ("stage_completed", "interviewer_agent"),
        ("stage_started", "career_master_agent"),
        ("stage_completed", "career_master_agent"),
        ("stage_started", "summary_agent"),
        ("stage_completed", "summary_agent"),
        ("pipeline_completed", "review_pipeline"),
    ]
