"""Explicitly load labeled fictional samples into the local data directory."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import *
from server import _write_json
now=datetime.now().astimezone()+timedelta(hours=1)
set_panel('calendar',normalize_calendar([{'title':'[Sample] Project check-in','start':now.isoformat(),'end':(now+timedelta(minutes=30)).isoformat()}]),source='fictional-sample')
set_panel('focus',{'top_priority':'[Sample] Prepare three discussion points'},source='fictional-sample')
set_panel('tasks',{'backlog':[['[Sample] Draft discussion points']],'progress':[],'done':[]},source='fictional-sample')
set_panel('reminders',{'items':[{'title':'[Sample] Review project outline'}]},source='fictional-sample')
rows=load_approvals()
if not any(r['id']=='sample-review' for r in rows):rows.append({'id':'sample-review','title':'[Sample] Review project outline','detail':'Record a local review decision. No email, calendar write or external action.','kind':'decision','source':'fictional-sample','status':'pending','created_at':now_iso()})
_write_json(DATA_DIR/'approvals.json',rows)
print('Labeled fictional samples loaded. No agents or providers called.')
