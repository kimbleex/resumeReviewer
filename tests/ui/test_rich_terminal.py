from types import SimpleNamespace

from rich.console import Console
from rich.spinner import Spinner

from app.schemas.review import (
    FinalResumeReview,
    PipelineEvent,
    ResumeDocument,
    ReviewRunResult,
    ReviewerFeedback,
    RevisionSuggestion,
    ScoreDetail,
)
from app.ui.rich_terminal import RichReviewTerminal


def test_rich_terminal_renders_final_report() -> None:
    console = Console(record=True, force_terminal=True, width=160)
    terminal = RichReviewTerminal(console=console)
    result = ReviewRunResult(
        document=ResumeDocument(
            path=__file__,
            file_type="txt",
            content="resume body",
        ),
        profile=None,
        reviewer_feedback=[
            ReviewerFeedback(
                agent_name="hr_agent",
                perspective="HR",
                overall_score=80,
                reasoning_summary=["Focused on keyword match and recruiter readability."],
                strengths=["Readable project titles"],
                concerns=["Need stronger metrics"],
                score_breakdown=[
                    ScoreDetail(label="ATS Match", score=82, reason="Keywords align with backend AI roles."),
                    ScoreDetail(label="Clarity", score=78, reason="Readable, but impact statements are thin."),
                ],
                suggestions=[
                    RevisionSuggestion(
                        section="Experience",
                        priority="high",
                        issue="Impact is vague.",
                        recommendation="Add outcome-focused bullets.",
                        example_rewrite="Raised recruiter response rate by 20% through sharper positioning.",
                    )
                ],
            )
        ],
        final_review=FinalResumeReview(
            overall_score=84,
            ready_level="promising",
            executive_summary="Strong technical foundation, but positioning can be sharper.",
            reasoning_summary=["Merged duplicate concerns and highlighted the highest ROI edits."],
            top_priorities=[
                "Rewrite the summary section, but keep the target role explicit.",
                "Quantify experience bullets.",
            ],
            score_breakdown=[
                ScoreDetail(label="Technical Credibility", score=86, reason="Projects read as real engineering work."),
                ScoreDetail(label="Positioning", score=74, reason="The target role is still a little blurry."),
            ],
            section_revisions=[
                RevisionSuggestion(
                    section="Summary",
                    priority="high",
                    issue="Headline is generic.",
                    recommendation="State the target role and differentiator.",
                    example_rewrite="AI Backend Engineer focused on multi-agent hiring systems.",
                )
            ],
        ),
    )

    terminal.render_final_report(result)

    output = console.export_text()
    assert "Resume Multi-Agent Review" in output
    assert "最终修改建议" in output
    assert "hr_agent" in output
    assert "84" in output
    assert "Rewrite the summary section, but keep the target role explicit." in output
    assert "Technical Credibility" in output
    assert "Positioning" in output


def test_running_stage_uses_spinner_renderable() -> None:
    terminal = RichReviewTerminal(console=Console(record=True, force_terminal=True, width=120))

    status = terminal._build_status_cell("resume_parser", "running")

    assert isinstance(status, Spinner)


def test_stage_completion_prints_agent_result_panel() -> None:
    console = Console(record=True, force_terminal=True, width=160)
    terminal = RichReviewTerminal(console=console)
    terminal._live = SimpleNamespace(update=lambda _: None, console=console)

    terminal.on_event(
        PipelineEvent(
            kind="stage_completed",
            stage="hr_agent",
            title="hr_agent 评审完成",
            message="得分 80/100",
            details=["Focused on recruiter readability."],
            payload={
                "agent_name": "hr_agent",
                "perspective": "HR",
                "overall_score": 80,
                "strengths": ["Readable titles"],
                "concerns": ["Need stronger metrics"],
                "score_breakdown": [{"label": "ATS Match", "score": 82, "reason": "Good keyword fit."}],
                "suggestions": [
                    {
                        "section": "Experience",
                        "priority": "high",
                        "issue": "Impact is vague.",
                        "recommendation": "Add numbers.",
                        "example_rewrite": "Reduced manual review time by 35%.",
                    }
                ],
            },
        )
    )

    output = console.export_text()
    assert "hr_agent 评审完成" in output
    assert "Readable titles" in output
    assert "ATS Match" in output
