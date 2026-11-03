"""Helpers for things shared from the YouVersion Bible app."""
import re


def bible_com_link(text: str) -> str | None:
    """https://www.bible.com/bible/111/JHN.3.16-18.NIV → 'John 3:16-18'."""
    m = re.search(r"bible\.com/(?:[a-z-]+/)?bible/\d+/([1-3]?[A-Z]{2,3})\.(\d+)(?:\.(\d+)(?:-(\d+))?)?", text)
    if not m:
        return None
    usfm = {"GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers", "DEU": "Deuteronomy", "JOS": "Joshua",
            "JDG": "Judges", "RUT": "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
            "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra", "NEH": "Nehemiah", "EST": "Esther", "JOB": "Job",
            "PSA": "Psalms", "PRO": "Proverbs", "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah",
            "JER": "Jeremiah", "LAM": "Lamentations", "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea", "JOL": "Joel",
            "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah", "MIC": "Micah", "NAM": "Nahum", "HAB": "Habakkuk",
            "ZEP": "Zephaniah", "HAG": "Haggai", "ZEC": "Zechariah", "MAL": "Malachi", "MAT": "Matthew", "MRK": "Mark",
            "LUK": "Luke", "JHN": "John", "ACT": "Acts", "ROM": "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians",
            "GAL": "Galatians", "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians", "1TH": "1 Thessalonians",
            "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy", "TIT": "Titus", "PHM": "Philemon",
            "HEB": "Hebrews", "JAS": "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John",
            "3JN": "3 John", "JUD": "Jude", "REV": "Revelation"}
    book = usfm.get(m.group(1))
    if not book:
        return None
    ref = f"{book} {m.group(2)}"
    if m.group(3):
        ref += f":{m.group(3)}" + (f"-{m.group(4)}" if m.group(4) else "")
    return ref
