from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship

from .db import Base


class Title(Base):
    __tablename__ = "titles"
    id = Column(Integer, primary_key=True)
    title = Column(String(500), nullable=False, index=True)
    author = Column(String(300))
    publisher = Column(String(300))
    year = Column(String(16))
    isbn = Column(String(32), index=True)
    edition = Column(String(64))
    url = Column(String(1000))
    raw_subjects = Column(Text)  # optional, when present in source
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_title_isbn_unique", "isbn", unique=False),
    )


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True)
    campus = Column(String(200), index=True)
    college = Column(String(300), index=True)
    program = Column(String(300), index=True)
    major = Column(String(300))
    course_code = Column(String(64), index=True)
    course_title = Column(String(500))
    description = Column(Text)
    learning_outcomes = Column(Text)
    keywords = Column(Text)
    enrollment = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class Match(Base):
    __tablename__ = "matches"
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id"), index=True)
    title_id = Column(Integer, ForeignKey("titles.id"), index=True)
    score = Column(Float, default=0.0)
    rank = Column(Integer, default=0)
    explanation = Column(Text)
    overridden = Column(Integer, default=0)  # 0/1 flag
    created_at = Column(DateTime, default=datetime.utcnow)

    course = relationship("Course")
    title = relationship("Title")

    __table_args__ = (UniqueConstraint("course_id", "title_id", name="uq_course_title"),)
