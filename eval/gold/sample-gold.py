# Reproduces the gold-v1 sample (seed 20261007). Usage (from repo root):
#   grep -rhoE "NCT[0-9]{8}" eval scripts tests config/questionnaire/precision.generated.ts | sort -u > excl.txt   # run BEFORE eval/gold existed
#   python3 -I eval/gold/sample-gold.py excl.txt sample.json
# Reads ONLY id, groups, title, inclusion, exclusion, age, sex from public/data trial cards (stored facts are never read).
import json,glob,random,collections,sys
SEED=20261007
excl=set(open(sys.argv[1]).read().split())
trials={}
for f in sorted(glob.glob('public/data/shards/national-*/trials/*.json')):
    for k,v in json.load(open(f)).items():
        c=v['card']; trials[k]=dict(id=k,groups=c['groups'],title=c['title'],inc=c['inclusion'],exc=c['exclusion'],minAge=c.get('minAge'),maxAge=c.get('maxAge'),sex=c.get('sex'))
print(len(trials),file=sys.stderr)
by=collections.defaultdict(list)
for k in sorted(trials):
    t=trials[k]
    if k in excl: continue
    L=sum(len(x['text']) for x in t['inc']+t['exc'])
    if L<400 or L>8000 or not t['groups']: continue
    by[t['groups'][0]].append(k)
print({g:len(v) for g,v in by.items()},file=sys.stderr)
rng=random.Random(SEED)
groups=sorted(by)
pools={g:rng.sample(by[g],len(by[g])) for g in groups}
sel=[]
while len(sel)<120:
    for g in groups:
        if pools[g] and len(sel)<120: sel.append(pools[g].pop())
rng.shuffle(sel)
json.dump([trials[k] for k in sel],open(sys.argv[2],'w'))
print(len(sel),collections.Counter(trials[k]['groups'][0] for k in sel),file=sys.stderr)
