import json,subprocess,wave,sys
V='../voices/en_US-ryan-high.onnx'
lines=json.load(open('script.json')); t=0.6; cues=[]
for cid,txt,gap in lines:
    f=f'vo/{cid}.wav'
    subprocess.run([sys.executable,'-m','piper','-m',V,'-f',f,'--length-scale','1.07','--sentence-silence','0.25'],input=txt.encode(),check=True,capture_output=True)
    w=wave.open(f); d=w.getnframes()/w.getframerate(); w.close()
    cues.append({'id':cid,'text':txt,'start':round(t,3),'dur':round(d,3)})
    t+=d+gap
json.dump({'total':round(t+0.5,2),'cues':cues},open('cues.json','w'),indent=1)
print(t)
for c in cues: print(c['id'],c['start'],c['dur'])
