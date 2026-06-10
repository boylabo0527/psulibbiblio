from typing import Optional
from pydantic import BaseModel


class TitleOut(BaseModel):
    id: int
    title: str
    author: Optional[str] = None
    publisher: Optional[str] = None
    year: Optional[str] = None
    isbn: Optional[str] = None
    edition: Optional[str] = None
    url: Optional[str] = None

    class Config:
        from_attributes = True


class CourseIn(BaseModel):
    campus: Optional[str] = ""
    college: Optional[str] = ""
    program: Optional[str] = ""
    major: Optional[str] = ""
    course_code: Optional[str] = ""
    course_title: str
    description: Optional[str] = ""
    learning_outcomes: Optional[str] = ""
    keywords: Optional[str] = ""
    enrollment: Optional[int] = 0


class CourseOut(CourseIn):
    id: int

    class Config:
        from_attributes = True


class MatchOut(BaseModel):
    course_id: int
    title_id: int
    score: float
    rank: int
    explanation: Optional[str] = None
    overridden: int = 0

    class Config:
        from_attributes = True


class MatchOverride(BaseModel):
    course_id: int
    title_id: int
    keep: bool = True  # if False, removes the match


class RunMatchRequest(BaseModel):
    top_k: int = 10
    min_score: float = 0.05


class FilterParams(BaseModel):
    campus: Optional[str] = None
    college: Optional[str] = None
    program: Optional[str] = None
    course: Optional[str] = None
    author: Optional[str] = None
    publisher: Optional[str] = None
    year: Optional[str] = None
    style: str = "apa7"
