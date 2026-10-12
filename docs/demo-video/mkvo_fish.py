import json,os,subprocess,wave,urllib.request
KEY=open('../.fishkey').read().strip(); OUT='vo3'; os.makedirs(OUT,exist_ok=True)
lines=json.load(open('script2.json')); t=0.6; cues=[]
def tts(txt,path):
    req=urllib.request.Request('https://api.fish.audio/v1/tts',method='POST',data=json.dumps({'text':txt,'reference_id':'933563129e564b19a115bedd57b7406a','format':'wav'}).encode(),
        headers={'Authorization':'Bearer '+KEY,'Content-Type':'application/json','model':'s2.1-pro-free'})
    open(path+'.raw.wav','wb').write(urllib.request.urlopen(req,timeout=120).read())
    # trim leading/trailing silence
    subprocess.run(['ffmpeg','-v','error','-y','-i',path+'.raw.wav','-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse',path],check=True)
for cid,txt,gap in lines:
    f=f'{OUT}/{cid}.wav'
    if not os.path.exists(f): tts(txt,f)
    w=wave.open(f); d=w.getnframes()/w.getframerate(); w.close()
    cues.append({'id':cid,'text':txt,'start':round(t,3),'dur':round(d,3)}); t+=d+gap
    print(cid,round(d,2),flush=True)
json.dump({'total':round(t+0.5,2),'voice':'fish:933563129e564b19a115bedd57b7406a','cues':cues},open(f'{OUT}/cues.json','w'),indent=1)
print('total',round(t,1))
