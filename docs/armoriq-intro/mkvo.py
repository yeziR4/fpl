import json,os,subprocess,wave,urllib.request
KEY=open('../.fishkey').read().strip()
lines=json.load(open('script.json')); t=0.7; cues=[]
for cid,txt,gap in lines:
    f=f'vo/{cid}.wav'
    if not os.path.exists(f):
        req=urllib.request.Request('https://api.fish.audio/v1/tts',method='POST',data=json.dumps({'text':txt,'reference_id':'d36d89e2b6614791b742a7475661c872','format':'wav','prosody':{'speed':1.25}}).encode(),headers={'Authorization':'Bearer '+KEY,'Content-Type':'application/json','model':'s2.1-pro-free'})
        open(f+'.raw.wav','wb').write(urllib.request.urlopen(req,timeout=120).read())
        subprocess.run(['ffmpeg','-v','error','-y','-i',f+'.raw.wav','-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse',f],check=True)
    w=wave.open(f); d=w.getnframes()/w.getframerate(); w.close()
    cues.append({'id':cid,'text':txt,'start':round(t,3),'dur':round(d,3)}); t+=d+gap; print(cid,round(d,2),flush=True)
json.dump({'total':round(t+0.3,2),'cues':cues},open('cues.json','w'),indent=1); print('total',round(t,1))
