from pathlib import Path

import pytest

from app.services.resume_loader import ResumeLoader, UnsupportedResumeFormatError


def test_resume_loader_reads_plain_text_resume(tmp_path: Path) -> None:
    resume_path = tmp_path / "resume.txt"
    resume_path.write_text("Ada Lovelace\nBuilt analytical engine notes.", encoding="utf-8")

    document = ResumeLoader().load(resume_path)

    assert document.path == resume_path.resolve()
    assert document.file_type == "txt"
    assert "Ada Lovelace" in document.content


def test_resume_loader_rejects_unsupported_files(tmp_path: Path) -> None:
    resume_path = tmp_path / "resume.xlsx"
    resume_path.write_text("not a resume", encoding="utf-8")

    with pytest.raises(UnsupportedResumeFormatError):
        ResumeLoader().load(resume_path)
