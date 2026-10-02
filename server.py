#!/usr/bin/env python3
"""Local-only portable adapter for the existing Joy Home interface."""
from core import *
import core

def load_approvals(): return _read_json(DATA_DIR/'approvals.json',[])
# underscore names are intentionally imported explicitly.
from core import _read_json, _write_json
core.load_approvals=load_approvals

def messages(): return _read_json(DATA_DIR/'messages.json',[])
def queue(text):
    row={'id':'msg-'+uuid.uuid4().hex[:12],'role':'user','text':text,'ts':now_iso(),'status':'pending','session':'joy-home:main'}
    with LOCK: _write_json(DATA_DIR/'messages.json',(messages()+[row])[-200:])
    return row

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass # no user content in request logs
    def send_json(self,value,status=200):
        body=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def unavailable(self): return self.send_json({'ok':False,'error':'Integration not included in this local release subset'},503)
    def do_GET(self):
        p=urlparse(self.path).path
        if p in ('/','/joy-home/'): p='/joy-home/index.html'
        if p.startswith('/joy-home/'):
            f=ROOT/p.lstrip('/')
            if f.parent!=ROOT/'joy-home' or not f.is_file(): return self.send_json({'error':'Not found'},404)
            b=f.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(f.name)[0] or 'text/plain');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        if p in ('/api/state','/api/joy-home/state'): return self.send_json(build_dashboard_state())
        if p=='/api/mission': return self.send_json(build_mission())
        if p.startswith('/api/panels/'):
            name=p.split('/')[-1]
            if name not in PANELS:return self.send_json({'error':'Unknown panel'},404)
            return self.send_json({'ok':True,'panel':name,**(get_panel(name) or {'data':None,'available':False})})
        if p in ('/api/approvals','/api/joy-home/approvals'): return self.send_json({'ok':True,'approvals':[a for a in load_approvals() if a.get('status')=='pending'] if parse_qs(urlparse(self.path).query).get('status')==['pending'] else load_approvals()})
        if p=='/api/calendar/today':return self.send_json({'ok':True,'events':panel_data('calendar',[])})
        if p=='/api/projects':return self.send_json({'projects':panel_data('projects',[])})
        if p=='/api/joy-home/actions':return self.send_json({'ok':True,'actions':panel_data('actions',[])})
        if p=='/api/joy-home/action-records':return self.send_json({'ok':True,'actions':[]})
        if p=='/api/joy-home/health':return self.send_json({'ok':True,'voice':False,'realtime':False,'mode':'portable-local-subset','agent_connected':False})
        if p in ('/api/joy-home/realtime-status','/api/joy-home/readiness'):return self.send_json({'ok':True,'ready':False,'realtimeReady':False,'worker':{'ready':False,'status':'not-connected'}})
        if p=='/api/joy-home/capabilities':return self.send_json({'ok':True,'capabilities':[]})
        if p=='/api/joy':return self.send_json({'ok':True,'description':'Local panels, pending messages, explicit bridge replies and review-only approvals. No autonomous execution.','pending':'GET /api/joy/pending','reply':'POST /api/joy/reply {id,text}','panels':'POST /api/panels/<name>'})
        if p=='/api/joy/pending':return self.send_json({'ok':True,'messages':[m for m in messages() if m.get('status')=='pending']})
        if p=='/api/joy-home/models':return self.send_json({'ok':True,'models':[],'defaultModel':''})
        if p=='/api/joy-home/openclaw/config':return self.send_json({'ok':True,'agentLabel':'Joy · bridge not connected'})
        if p=='/api/joy-home/openclaw/sessions':return self.send_json({'ok':True,'sessions':[{'key':'joy-home:main','label':'Local queue','updatedAt':now_iso()}],'defaultSessionKey':'joy-home:main'})
        if p=='/api/joy-home/openclaw/history':return self.send_json({'ok':True,'messages':messages(),'live':{'running':False}})
        if p=='/api/joy-home/openclaw/live':return self.send_json({'ok':True,'live':{'running':False},'session':{'key':'joy-home:main'}})
        return self.unavailable()
    def do_POST(self):
        # Reject cross-origin browser writes. Only loopback is bound by main().
        origin=self.headers.get('Origin')
        if origin and urlparse(origin).netloc!=self.headers.get('Host'):return self.send_json({'error':'Origin mismatch'},403)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>1024*1024:return self.send_json({'error':'Request too large'},413)
            body=json.loads(self.rfile.read(size) or b'{}')
            if not isinstance(body,(dict,list)):raise ValueError('JSON object or array required')
            p=urlparse(self.path).path
            if p.startswith('/api/panels/'):
                name=p.split('/')[-1]
                if name not in PANELS:return self.send_json({'error':'Unknown panel'},404)
                return self.send_json({'ok':True,**set_panel(name,body.get('data') if isinstance(body,dict) and 'data' in body else body,source='local-api')})
            if p in ('/api/joy-home/process','/api/joy-home/openclaw/send'):
                text=str(body.get('transcript') or body.get('message') or '').strip()
                if not text:raise ValueError('Message required')
                row=queue(text)
                return self.send_json({'ok':True,'queued':True,'status':'queued','messageId':row['id'],'runId':row['id'],'patchApplied':False,'response':'Queued locally. No AI bridge is connected; no model has been called.'})
            if p=='/api/joy/reply':
                with LOCK:
                    rows=messages();msg=next((m for m in rows if m['id']==body.get('id') and m.get('status')=='pending'),None)
                    if not msg:return self.send_json({'error':'Pending message not found'},404)
                    text=str(body.get('text') or '').strip()
                    if not text:raise ValueError('Reply text required')
                    msg['status']='answered';rows.append({'id':'reply-'+uuid.uuid4().hex[:12],'role':'assistant','text':text,'ts':now_iso(),'source':'explicit-local-bridge'})
                    _write_json(DATA_DIR/'messages.json',rows[-200:])
                return self.send_json({'ok':True})
            if p in ('/api/joy-home/approve','/api/joy-home/reject'):
                with LOCK:
                    rows=load_approvals();row=next((r for r in rows if r['id']==str(body.get('id') or body.get('approval_id'))),None)
                    if not row:return self.send_json({'error':'Approval not found'},404)
                    if row.get('action'):return self.send_json({'error':'Executable actions are excluded; review only'},409)
                    row.update(status='done' if p.endswith('approve') else 'rejected',decided_at=now_iso(),result={'note':'Local review decision recorded. No external action executed.'});_write_json(DATA_DIR/'approvals.json',rows)
                return self.send_json({'ok':True,'approval':row,'copy':'Local review decision recorded. No external action executed.'})
            return self.unavailable()
        except (ValueError,TypeError):return self.send_json({'error':'Invalid request'},400)

if __name__=='__main__':
    port=int(os.environ.get('JOY_HOME_PORT','8765'))
    print(f'Joy Home local subset: http://127.0.0.1:{port}/joy-home/#home',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
