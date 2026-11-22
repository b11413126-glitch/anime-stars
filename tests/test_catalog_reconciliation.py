"""Synthetic protocol fixtures only; no source calls or public ranking writes."""
import copy,hashlib,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from catalog_reconciliation import validate_catalog_proof
from browser_import import ImportSession

def identity(n): return '/animeRef.php?sn='+str(n)
def item(n): return {'id':identity(n),'title':'測試'+str(n),'url':'https://ani.gamer.com.tw'+identity(n),'year':'2020/01','image':''}
def time(n): return '2026-11-22T00:'+f'{n//60:02d}:{n%60:02d}Z'
def make_pass(rows,sort,start):
    pages=[{'page':i+1,'totalPages':len(rows),'count':len(r),'ids':[identity(n) for n in r],'checkedAt':time(start+i+1)} for i,r in enumerate(rows)]
    frame={'first':{'page':1,'totalPages':len(rows),'ids':pages[0]['ids']},'last':{'page':len(rows),'totalPages':len(rows),'ids':pages[-1]['ids']}}
    return {'runId':str(sort)+'-'+str(start),'sort':sort,'checkedFrom':time(start),'completedAt':time(start+len(rows)+1),
      'pages':pages,'anchors':{'start':copy.deepcopy(frame),'end':copy.deepcopy(frame)}}
def proof(a,b,start=0):
    passes=[make_pass(a,1,start),make_pass(b,2,start+10)]
    values=sorted({n for rows in [a,b] for row in rows for n in row})
    return [item(n) for n in values],{'version':2,'source':'gamer-page-count-reconciliation','confirmedAt':time(start+20),
      'passes':passes,'expectedTotal':(len(a)-1)*len(a[0])+len(a[-1]),'catalogCount':len(values),
      'overlapCount':sum(sum(len(r) for r in rows)-len({n for r in rows for n in r}) for rows in [a,b]),
      'idSHA256':hashlib.sha256('\n'.join(sorted(identity(n) for n in values)).encode()).hexdigest()}
ROBOTS={'https://ani.gamer.com.tw/':'User-agent: *\nAllow: /','https://api.gamer.com.tw/':'User-agent: *\nAllow: /'}

class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.root=Path(self.temp.name);(self.root/'site').mkdir();(self.root/'site/data.json').write_text('previous',encoding='utf-8')
        self.session=ImportSession(self.root)
    def tearDown(self): self.temp.cleanup()
    def begin(self,rows=None):
        catalog,p=proof(rows or [[1,2]],rows or [[2,1]])
        return self.session.accept({'kind':'begin','catalog':catalog,'catalogProof':p,'catalogSort':1,
          'region':'TW','checkedFrom':time(0),'robots':ROBOTS,'delaySeconds':2.6})
    def record(self,n,at=30):
        return {'animeSn':n,'checkedAt':time(at),'data':{'anime':{'animeSn':n,'score':4.9,'reviewCount':123,'tags':['奇幻'],'favorite':True,
          'title':'測試'+str(n)+' [1]','acgSn':n,'maker':'測試公司','seasonStart':'2020/01/01'},
          'video':{'animeSn':n,'videoSn':n+100,'upTime':'2020/01/01 00:00','downTime':'','watchingPermission':{'pass':True},
          'requestParentPassword':False,'ratingDesc':'一般觀眾皆可觀賞。'}}}
    def test_overlap_with_reconciled_count_passes(self):
        catalog,p=proof([[1,2],[2,3]],[[4,3],[2,1]])
        self.assertEqual(len(validate_catalog_proof(catalog,p)),4)
    def test_missing_unique_work_is_rejected(self):
        catalog,p=proof([[1,2],[2,3]],[[3,2],[2,1]])
        with self.assertRaisesRegex(ValueError,'union 3 != expected 4'): validate_catalog_proof(catalog,p)
    def test_cross_sort_union_repairs_both_incomplete_passes(self):
        catalog,p=proof([[1,2],[2,3]],[[4,3],[3,2]])
        self.assertEqual(len(validate_catalog_proof(catalog,p)),4)
    def test_incomplete_or_tampered_receipts_rejected(self):
        catalog,p=proof([[1,2],[3,4]],[[4,3],[2,1]])
        p['passes'][1]['pages'].pop()
        with self.assertRaises(ValueError): validate_catalog_proof(catalog,p)
    def test_incremental_new_work_must_be_verified_before_finish(self):
        self.begin();self.session.accept({'kind':'batch','offset':0,'records':[self.record(1),self.record(2)]})
        catalog,p=proof([[2,3,1]],[[3,1,2]],60)
        result=self.session.accept({'kind':'recheck','catalog':catalog,'catalogProof':p,'robots':ROBOTS,'delaySeconds':2.6})
        self.assertEqual(result['pending'],1)
        with self.assertRaises(ValueError): self.session.accept({'kind':'finish','catalogProof':p})
        self.assertEqual((self.root/'site/data.json').read_text(encoding='utf-8'),'previous')
        self.session.accept({'kind':'batch','offset':2,'records':[self.record(3,90)]})
        with self.assertRaises(ValueError): self.session.accept({'kind':'finish','catalogProof':p})
        latest,p2=proof([[3,2,1]],[[1,3,2]],120)
        self.session.accept({'kind':'recheck','catalog':latest,'catalogProof':p2,'robots':ROBOTS,'delaySeconds':2.6})
        self.assertTrue(self.session.accept({'kind':'finish','catalogProof':p2})['ok'])
        d=json.loads((self.root/'site/data.json').read_text(encoding='utf-8'))
        self.assertEqual(len(d['items']),3)
        self.assertEqual({r['checkedAt'] for r in d['items'] if r['id']!=identity(3)},{time(30)})
        self.assertNotIn('favorite',json.dumps(d))
    def test_incremental_removal_requires_official_fixed_video_evidence(self):
        self.begin();self.session.accept({'kind':'batch','offset':0,'records':[self.record(1),self.record(2)]})
        catalog,p=proof([[2]],[[2]],60)
        request={'kind':'recheck','catalog':catalog,'catalogProof':p,'robots':ROBOTS,'delaySeconds':2.6}
        with self.assertRaises(ValueError): self.session.accept(request)
        request['removals']=[{'id':identity(1),'reason':'confirmed-source-expiry','message':'目前無此動畫或動畫授權已到期！',
          'sourceURL':'https://ani.gamer.com.tw/animeVideo.php?sn=101','checkedAt':time(75)}]
        self.assertEqual(self.session.accept(request)['removed'],1)
        self.assertTrue(self.session.accept({'kind':'finish','catalogProof':p})['ok'])
    def test_invalid_batch_rolls_back_all_records(self):
        self.begin();bad=self.record(2);bad['data']['anime']['tags']=None
        with self.assertRaises(ValueError): self.session.accept({'kind':'batch','offset':0,'records':[self.record(1),bad]})
        self.assertEqual(json.loads(self.session.state_path.read_text(encoding='utf-8'))['processed'],0)
    def test_missing_manufacturer_or_wrong_work_version_never_advances_batch(self):
        self.begin()
        for change in [{'maker':None},{'title':'其他作品 [1]'},{'acgSn':0}]:
            r=self.record(1);r['data']['anime'].update(change)
            with self.assertRaises((ValueError,TypeError)):
                self.session.accept({'kind':'batch','offset':0,'records':[r]})
            self.assertEqual(json.loads(self.session.state_path.read_text(encoding='utf-8'))['processed'],0)

if __name__=='__main__': unittest.main()
