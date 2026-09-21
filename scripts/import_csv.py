#!/usr/bin/env python3
"""Convert the original videos_course_info.csv into protected data/courses.json."""
import csv, json, html, re, sys
from pathlib import Path

src=Path(sys.argv[1] if len(sys.argv)>1 else 'videos_course_info.csv')
out=Path(sys.argv[2] if len(sys.argv)>2 else Path(__file__).resolve().parents[1]/'data'/'courses.json')

fields={
 'id':'video_id','video':'video_name','topicId':'topic_id','topic':'topic_name','lessonId':'lesson_id','lesson':'lesson_name',
 'teacher':'teacher_id','subject':'subject_id','section':'class_section_id',
 'free':'is_lesson_free','denied':'policy_denied','type':'api.file.type_detail',
 'download':'api.file.download_link','path':'api.file.video_path',
 'thumb':'api.file.lesson_topic.thumbnail','lessonThumb':'api.file.lesson.thumbnail',
 'description':'api.file.lesson.description','topicDescription':'api.file.lesson_topic.description',
 'duration':'api.file.duration','price':'api.file.file_price',
}

def blank(v): return v is None or not str(v).strip()
def integer(v):
    if blank(v): return None
    try: return int(float(v))
    except ValueError: return str(v).strip()
def number(v):
    if blank(v): return None
    try:
        f=float(v); return int(f) if f.is_integer() else f
    except ValueError: return str(v).strip()
def boolean(v):
    if blank(v): return None
    s=str(v).strip().lower()
    if s in {'true','1','yes'}: return True
    if s in {'false','0','no'}: return False
    return s
def text(v): return None if blank(v) else str(v).strip()
def clean_desc(v):
    v=text(v)
    if not v: return None
    v=re.sub(r'<[^>]+>',' ',v)
    return html.unescape(re.sub(r'\s+',' ',v)).strip()[:800]

records=[]
with src.open('r',encoding='utf-8-sig',newline='') as f:
    reader=csv.DictReader(f)
    for row in reader:
        meaningful=any(not blank(row.get(k)) for k in ('video_name','topic_name','lesson_name','api.file.download_link','api.file.video_path'))
        if not meaningful: continue
        rec={k:text(row.get(col)) for k,col in fields.items()}
        for k in ('id','topicId','lessonId','teacher','subject','section'): rec[k]=integer(row.get(fields[k]))
        for k in ('free','denied'): rec[k]=boolean(row.get(fields[k]))
        for k in ('duration','price'): rec[k]=number(row.get(fields[k]))
        rec['description']=clean_desc(row.get(fields['description']))
        rec['topicDescription']=clean_desc(row.get(fields['topicDescription']))
        if not rec['thumb']: rec['thumb']=rec['lessonThumb']
        records.append(rec)
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(records,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'Wrote {len(records)} rows to {out}')
