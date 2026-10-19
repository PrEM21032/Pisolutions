import fs from 'node:fs';

const repo=process.env.GITHUB_REPOSITORY || 'pisolutions9/Pisolutions9';
const token=process.env.GITHUB_TOKEN || '';
if(!token) throw new Error('GITHUB_TOKEN_required');
const [owner,name]=repo.split('/');
const historyPath='pi/engineering-history.json';
const ownerHistoryPath='worker/src/owner-history.mjs';
const history=JSON.parse(fs.readFileSync(historyPath,'utf8'));

function utcDate(d){ return d.toISOString().slice(0,10); }
const target=process.env.TARGET_DATE || utcDate(new Date(Date.now()-24*60*60*1000));
if(!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('TARGET_DATE_invalid');
if(target < String(history.backfill?.startsAt || '0000-00-00')) throw new Error('TARGET_DATE_before_history_start');
const start=target+'T00:00:00Z';
const end=target+'T23:59:59Z';

async function api(path){
  const res=await fetch('https://api.github.com'+path,{headers:{
    authorization:'Bearer '+token,
    accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28',
    'user-agent':'pi-owner-history-updater'
  }});
  if(!res.ok) throw new Error('github_api_'+res.status+'_'+path+'_'+(await res.text()).slice(0,300));
  return res.json();
}
async function pages(path, extract=x=>x){
  const out=[];
  for(let page=1;page<=100;page++){
    const join=path.includes('?')?'&':'?';
    const body=await api(path+join+'per_page=100&page='+page);
    const items=extract(body);
    if(!Array.isArray(items)) throw new Error('github_page_not_array');
    out.push(...items);
    if(items.length<100) break;
  }
  return out;
}

const commits=await pages(`/repos/${owner}/${name}/commits?since=${encodeURIComponent(start)}&until=${encodeURIComponent(end)}`);
const issueCandidates=await pages(`/repos/${owner}/${name}/issues?state=all&since=${encodeURIComponent(start)}`);
const issues=issueCandidates.filter(x=>!x.pull_request);
const issuesCreated=issues.filter(x=>String(x.created_at||'').slice(0,10)===target).length;
const issuesClosed=issues.filter(x=>String(x.closed_at||'').slice(0,10)===target).length;
const openIssues=(await pages(`/repos/${owner}/${name}/issues?state=open`)).filter(x=>!x.pull_request).length;

const workflows=await pages(`/repos/${owner}/${name}/actions/workflows`,body=>body.workflows||[]);
const runs=[];
for(const workflow of workflows){
  const workflowRuns=await pages(
    `/repos/${owner}/${name}/actions/workflows/${workflow.id}/runs?created=${encodeURIComponent(target)}`,
    body=>body.workflow_runs||[]
  );
  runs.push(...workflowRuns);
}

const completed=runs.filter(r=>r.status==='completed');
const passed=completed.filter(r=>r.conclusion==='success');
const failed=completed.filter(r=>['failure','timed_out','action_required','startup_failure','stale'].includes(r.conclusion));
const cancelled=completed.filter(r=>r.conclusion==='cancelled');
const isRelease=r=>/(gate|verify)/i.test(String(r.name||''));
const row={
  date:target,
  commits:commits.length,
  issuesCreated,
  issuesClosed,
  workflowRuns:runs.length,
  workflowsCompleted:completed.length,
  workflowsPassed:passed.length,
  workflowsFailed:failed.length,
  workflowsCancelled:cancelled.length,
  releaseChecksPassed:passed.filter(isRelease).length,
  releaseChecksFailed:failed.filter(isRelease).length,
  pagesPassed:passed.filter(r=>/^PI Pages$/i.test(String(r.name||''))).length,
  workerPassed:passed.filter(r=>/^PI Chat Worker$/i.test(String(r.name||''))).length,
  additions:null,
  deletions:null,
  filesChanged:null,
  // The collector only records completed UTC days, so its rows are final, not partial snapshots.
  snapshotPartialDay:false
};

history.daily=Array.isArray(history.daily)?history.daily:[];
const index=history.daily.findIndex(r=>r.date===target);
if(index>=0) history.daily[index]=row; else history.daily.push(row);
history.daily.sort((a,b)=>a.date.localeCompare(b.date));
history.totals={
  commits:history.daily.reduce((n,r)=>n+Number(r.commits||0),0),
  issuesCreated:history.daily.reduce((n,r)=>n+Number(r.issuesCreated||0),0),
  issuesClosed:history.daily.reduce((n,r)=>n+Number(r.issuesClosed||0),0),
  issuesOpen:openIssues,
  workflowRuns:history.daily.reduce((n,r)=>n+Number(r.workflowRuns||0),0)
};
history.backfill={...(history.backfill||{}),autoUpdate:{
  enabled:true,
  cadence:'daily',
  timezone:'UTC',
  finalizedThrough:target,
  source:'GitHub REST API via authenticated GitHub Actions',
  collectorVersion:1
}};

fs.writeFileSync(historyPath,JSON.stringify(history,null,2)+'\n');
fs.writeFileSync(ownerHistoryPath,'export const OWNER_HISTORY = Object.freeze('+JSON.stringify(history,null,2)+');\n');
console.log(JSON.stringify({target,row,totals:history.totals}));
