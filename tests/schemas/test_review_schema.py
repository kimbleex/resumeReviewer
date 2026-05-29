from app.schemas.review import FinalResumeReview, ResumeProfile, ReviewerFeedback


def test_resume_profile_coerces_nested_llm_output() -> None:
    profile = ResumeProfile.model_validate(
        {
            "candidate_name": "Ada Lovelace",
            "title": "AI Backend Engineer",
            "target_roles": {"primary": ["AI Engineer"], "secondary": ["Platform Engineer"]},
            "core_skills": {"programming": ["Python"], "frameworks": ["LangChain"]},
            "strengths": [{"text": "Strong ownership"}, {"summary": "Clear technical scope"}],
            "risks": [{"text": "Needs more metrics"}],
            "missing_information": {"items": ["Target industry"]},
            "reasoning_summary": {"items": ["Parsed technical focus from project descriptions."]},
        }
    )

    assert profile.headline == "AI Backend Engineer"
    assert profile.target_roles == ["AI Engineer", "Platform Engineer"]
    assert profile.core_skills == ["Python", "LangChain"]
    assert profile.strengths == ["Strong ownership", "Clear technical scope"]
    assert profile.risks == ["Needs more metrics"]
    assert profile.missing_information == ["Target industry"]
    assert profile.reasoning_summary == ["Parsed technical focus from project descriptions."]


def test_resume_profile_supports_structured_resume_sections() -> None:
    profile = ResumeProfile.model_validate(
        {
            "personal_info": {
                "name": "Ada Lovelace",
                "age": "28",
                "phone": "+86 13800000000",
                "email": "ada@example.com",
                "location": "Shanghai",
                "links": ["https://github.com/ada"],
            },
            "headline": "AI Backend Engineer",
            "skill_groups": [
                {"category": "Programming", "items": ["Python", "SQL"]},
                {"category": "Frameworks", "items": ["LangChain"]},
            ],
            "work_experiences": [
                {
                    "company": "OpenAI",
                    "role": "Backend Engineer",
                    "period": "2023-2025",
                    "responsibilities": ["Built agent orchestration services."],
                    "achievements": ["Reduced review latency by 30%."],
                }
            ],
            "projects": [
                {
                    "name": "Resume Reviewer",
                    "role": "Backend Lead",
                    "period": "2025",
                    "technologies": ["Python", "LangChain"],
                    "highlights": ["Built a multi-agent resume evaluation workflow."],
                }
            ],
            "education_records": [
                {
                    "school": "MIT",
                    "degree": "BS",
                    "major": "Computer Science",
                    "period": "2018-2022",
                }
            ],
            "strengths": ["Strong backend ownership"],
            "risks": ["Needs more quantified impact"],
        }
    )

    assert profile.candidate_name == "Ada Lovelace"
    assert profile.personal_info.name == "Ada Lovelace"
    assert profile.personal_info.phone == "+86 13800000000"
    assert profile.core_skills == ["Python", "SQL", "LangChain"]
    assert profile.skill_groups[0].category == "Programming"
    assert profile.work_experiences[0].company == "OpenAI"
    assert profile.projects[0].name == "Resume Reviewer"
    assert profile.education_records[0].school == "MIT"


def test_reviewer_feedback_tolerates_missing_metadata_and_stringified_score() -> None:
    feedback = ReviewerFeedback.model_validate(
        {
            "overall_score": "82/100",
            "reasoning_summary": {"items": ["Focused on recruiter readability."]},
            "strengths": [{"text": "Readable structure"}],
            "concerns": [{"text": "Needs quantified outcomes"}],
            "suggestions": [
                {
                    "section": "Experience",
                    "priority": "高",
                    "issue": "Impact is vague.",
                    "recommendation": "Add metrics.",
                }
            ],
        }
    )

    assert feedback.agent_name == ""
    assert feedback.perspective == ""
    assert feedback.overall_score == 82
    assert feedback.reasoning_summary == ["Focused on recruiter readability."]
    assert feedback.strengths == ["Readable structure"]
    assert feedback.concerns == ["Needs quantified outcomes"]
    assert feedback.suggestions[0].priority == "high"


def test_score_breakdown_accepts_string_items() -> None:
    feedback = ReviewerFeedback.model_validate(
        {
            "overall_score": 80,
            "score_breakdown": [
                "ATS Match: 82/100 - keyword fit is good",
                "Clarity：76分 - bullets are readable but metrics are thin",
            ],
        }
    )

    assert feedback.score_breakdown[0].label == "ATS Match"
    assert feedback.score_breakdown[0].score == 82
    assert feedback.score_breakdown[0].reason == "keyword fit is good"
    assert feedback.score_breakdown[1].label == "Clarity"
    assert feedback.score_breakdown[1].score == 76


def test_final_resume_review_normalizes_ready_level() -> None:
    review = FinalResumeReview.model_validate(
        {
            "overall_score": "88",
            "ready_level": "有潜力",
            "executive_summary": {"text": "Strong technical foundation, with room for sharper positioning."},
            "top_priorities": {"items": ["Quantify impact, but keep the narrative crisp."]},
            "section_revisions": [],
        }
    )

    assert review.overall_score == 88
    assert review.ready_level == "promising"
    assert review.executive_summary == "Strong technical foundation, with room for sharper positioning."
    assert review.top_priorities == ["Quantify impact, but keep the narrative crisp."]
