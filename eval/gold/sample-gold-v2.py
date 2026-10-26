# Reproduces the gold-v2 sample (seed 20261108). Usage (from repo root):
#   grep -rhoE "NCT[0-9]{8}" eval scripts tests config/questionnaire/precision.generated.ts --exclude-dir=gold | sort -u > excl.txt
#   python3 -I eval/gold/sample-gold-v2.py excl.txt eval/gold/gold-v1.json sample-v2.json
# (excl.txt = the same 1,471 IDs as batch 1; gold-v1.json IDs are excluded in addition.)
# Reads ONLY id, groups, title, inclusion, exclusion, age, sex from public/data trial cards (stored facts are never read).
# Stratum "keyword": 60 trials whose raw criteria text matches KEYWORDS (sparse-case oversample);
# stratum "random": 60 trials from the remaining pool. Both drawn round-robin across groups (alphabetical), pools shuffled.
import json,glob,random,collections,sys,re
SEED=20261108
KEYWORDS=re.compile(r"hepatitis|\bHBV\b|\bHCV\b|\bHBsAg\b|lines? of|prior lines?|previous lines?|relapsed|refractory|\bstage\b|biomarker|mutation|\bPD-?L1\b|\bHER2\b|\bEGFR\b|\bALK\b|\bBRAF\b|\bKRAS\b|\bMSI\b|\bBRCA\b|positive for|negative for|second primary|other malignanc|prior malignanc|another malignanc|other cancer|previous cancer|history of (?:a )?(?:other )?(?:malignan|cancer)",re.I)
excl=set(open(sys.argv[1]).read().split())
excl|={t['trial_id'] for t in json.load(open(sys.argv[2]))['trials']}
trials={}
for f in sorted(glob.glob('public/data/shards/national-*/trials/*.json')):
    for k,v in json.load(open(f)).items():
        c=v['card']; trials[k]=dict(id=k,groups=c['groups'],title=c['title'],inc=c['inclusion'],exc=c['exclusion'],minAge=c.get('minAge'),maxAge=c.get('maxAge'),sex=c.get('sex'))
print(len(trials),file=sys.stderr)
pool=[]
for k in sorted(trials):
    t=trials[k]
    if k in excl: continue
    txt="\n".join(x['text'] for x in t['inc']+t['exc'])
    if len(txt)<400 or len(txt)>8000 or not t['groups']: continue
    pool.append((k,bool(KEYWORDS.search(txt))))
rng=random.Random(SEED)
def draw(ids,n):
    by=collections.defaultdict(list)
    for k in ids: by[trials[k]['groups'][0]].append(k)
    groups=sorted(by); pools={g:rng.sample(by[g],len(by[g])) for g in groups}
    sel=[]
    while len(sel)<n:
        for g in groups:
            if pools[g] and len(sel)<n: sel.append(pools[g].pop())
    return sel
kw=draw([k for k,m in pool if m],60)
rest=draw([k for k,m in pool if k not in set(kw)],60)
sel=[(k,'keyword') for k in kw]+[(k,'random') for k in rest]
rng.shuffle(sel)
out=[dict(trials[k],stratum=s) for k,s in sel]
json.dump(out,open(sys.argv[3],'w'))
print(len(out),collections.Counter(o['stratum'] for o in out),collections.Counter(o['groups'][0] for o in out),file=sys.stderr)
