import json,sys,numpy as np,wave,subprocess
name,T=sys.argv[1],float(sys.argv[2]); SR=44100; N=int(T*SR)
def rd(p,ch=2):
    w=wave.open(p); a=np.frombuffer(w.readframes(w.getnframes()),'<i2').astype(float)/32768
    return a.reshape(-1,w.getnchannels())
cues=json.load(open(f'cues_{name}.json'))['cues']; vo=np.zeros(N)
for c in cues:
    a=rd(f"vo/{c['id']}.wav")[:,0]; i=int(c['start']*SR); vo[i:i+len(a)]+=a[:N-i]
m=rd(f'gen/music_{name}.wav'); mus=np.zeros((N,2)); mus[:min(N,len(m))]=m[:N]
# ducking envelope from VO
def ma(x,k):
    c=np.cumsum(np.insert(x,0,0)); y=(c[k:]-c[:-k])/k; return np.concatenate([np.full(k//2,y[0]),y,np.full(len(x)-len(y)-k//2,y[-1])])
env=ma(np.abs(vo),int(.25*SR)); duck=np.where(env>0.01,0.12,0.32); duck=ma(duck,int(.3*SR))
mus*=duck[:,None]; f=int(2.5*SR); mus[-f:]*=np.linspace(1,0,f)[:,None]; mus[:int(.8*SR)]*=np.linspace(0,1,int(.8*SR))[:,None]
fx=np.zeros((N,2)); M={'pop':'tick','tick':'tick','whoosh':'whoosh','hit':'impact'}
for kk,t,g in json.load(open(f'meta_{name}.json'))['sfx']:
    a=rd(f'../pot/gen/sfx_{M.get(kk,"tick")}.wav'); i=int(t*SR); j=min(N,i+len(a)); fx[i:j]+=a[:j-i]*g*0.18
out=np.stack([vo,vo],1)*1.0+mus+fx
w=wave.open(f'mix_{name}_raw.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(out,-1,1)*32767).astype('<i2').tobytes()); w.close()
subprocess.run(['ffmpeg','-v','error','-y','-i',f'mix_{name}_raw.wav','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar','44100',f'mix_{name}.wav'],check=True)
caps=json.load(open(f'meta_{name}.json'))['caps']
ff=lambda t:'%02d:%02d:%02d,%03d'%(t//3600,t%3600//60,int(t%60),round((t%1)*1000)%1000)
open(f'tari-{name}.srt','w').write('\n'.join(f"{i+1}\n{ff(a)} --> {ff(b)}\n{s}\n" for i,(a,b,s) in enumerate(caps)))
print('ok',name)
