import os,sys,tempfile,threading,urllib.request,urllib.error,json,unittest
from pathlib import Path
os.environ['JOY_HOME_DATA']=tempfile.mkdtemp(prefix='joy-test-')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server as joy
http=joy.ThreadingHTTPServer(('127.0.0.1',0),joy.Handler)
threading.Thread(target=http.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(http.server_port)
def call(path,data=None):
 r=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r) as f:return f.status,json.load(f)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
class ReleaseTests(unittest.TestCase):
 def test_panel_persist(self):
  self.assertEqual(call('/api/panels/focus',{'top_priority':'[Test] Outline'})[0],200)
  self.assertEqual(call('/api/joy-home/state')[1]['top_priority'],'[Test] Outline')
 def test_queue_reply(self):
  row=call('/api/joy-home/openclaw/send',{'message':'[Test] Neutral request'})[1]
  self.assertEqual(row['status'],'queued')
  self.assertTrue(any(m['id']==row['messageId'] for m in call('/api/joy/pending')[1]['messages']))
  self.assertEqual(call('/api/joy/reply',{'id':row['messageId'],'text':'[Test fixture] Explicit bridge reply; not AI.'})[0],200)
  self.assertEqual(call('/api/joy/reply',{'id':row['messageId'],'text':'duplicate'})[0],404)
  self.assertEqual(call('/api/joy-home/openclaw/history')[1]['messages'][-1]['source'],'explicit-local-bridge')
 def test_review(self):
  joy._write_json(joy.DATA_DIR/'approvals.json',[{'id':'test-review','status':'pending','kind':'draft'}])
  status,data=call('/api/joy-home/approve',{'id':'test-review'})
  self.assertEqual(status,200);self.assertEqual(data['approval']['status'],'done')
  self.assertEqual(call('/api/joy-home/approve',{'id':'test-review'})[1]['approval']['status'],'done')
 def test_executable_rejected(self):
  joy._write_json(joy.DATA_DIR/'approvals.json',[{'id':'execute','status':'pending','action':{'handler':'calendar_create'}}])
  self.assertEqual(call('/api/joy-home/approve',{'id':'execute'})[0],409)
  self.assertEqual(joy.load_approvals()[0]['status'],'pending')
 def test_traversal(self):
  self.assertEqual(call('/api/panels/../../secret',{})[0],404)
  self.assertEqual(call('/joy-home/../server.py')[0],404)
 def test_missing_integration(self):
  self.assertEqual(call('/api/voice/transcribe',{})[0],503)
  self.assertFalse(call('/api/joy-home/health')[1]['agent_connected'])
 def test_audio_framing(self):
  for suffix in (b'\r',b'\n',b'-',b'\r\n',b'--'):
   audio=b'RIFFtest'+suffix
   body=b'--b\r\nContent-Disposition: form-data; name="audio"; filename="test.wav"\r\n\r\n'+audio+b'\r\n--b--\r\n'
   self.assertEqual(joy.parse_multipart_file(body,'multipart/form-data; boundary=b')[1],audio)
 def test_empty_text(self):self.assertEqual(call('/api/joy-home/openclaw/send',{'message':''})[0],400)
 def test_cross_origin(self):
  req=urllib.request.Request(base+'/api/panels/focus',data=b'{}',headers={'Origin':'https://example.invalid'})
  with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(req)
  self.assertEqual(ctx.exception.code,403)
if __name__=='__main__':
 try:unittest.main()
 finally:http.shutdown()
