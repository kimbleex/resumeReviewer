from app.services.resume_signal_extractor import ResumeSignalExtractor


def test_resume_signal_extractor_reads_contact_signals() -> None:
    resume_text = """
    Ada Lovelace
    年龄: 28
    手机: +86 13800000000
    Email: ada@example.com
    Location: Shanghai
    GitHub: https://github.com/ada
    LinkedIn: https://www.linkedin.com/in/ada
    """

    hints = ResumeSignalExtractor().extract(resume_text)

    assert hints.personal_info.name == "Ada Lovelace"
    assert hints.personal_info.age == "28"
    assert hints.personal_info.phone == "+86 13800000000"
    assert hints.personal_info.email == "ada@example.com"
    assert hints.personal_info.location == "Shanghai"
    assert "https://github.com/ada" in hints.personal_info.links
    assert "https://www.linkedin.com/in/ada" in hints.personal_info.links
