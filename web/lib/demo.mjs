import { STAGES } from './model.mjs';
export const DEMO_VERSION = 2;

export function demoWorkspace(now = new Date()) {
  const day = offset => { const date = new Date(now); date.setDate(date.getDate()+offset); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
  const seed = [
    ['Northstar Cloud','Jamie Rivera','Committed',6000,'Developer tools','#526cde','Offer accepted. Student developer credits plus cash sponsorship.','Confirm logo assets',4],
    ['Cedar Labs','Jordan Ellis','Negotiating',4000,'Technology','#b47d45','Warm introduction from alumni network. Interested in recruiting and a mentor session.','Share updated sponsorship package',0],
    ['Lantern Design','Taylor Chen','Replied',2500,'Design','#b676a5','Previously sponsored a design jam. Prefers a short pitch with participant demographics.','Send audience breakdown',1],
    ['Orbit Hardware','Sam Patel','Committed',3500,'Hardware','#dc8a4b','Returning partner. Confirmed hardware prizes and cash support.','Arrange prize delivery',5],
    ['Meridian Finance','Avery Kim','Contacted',3000,'Finance','#438b81','Community programs team supports student entrepreneurship. Introduction via faculty.','Follow up on initial pitch',-1],
    ['Juniper Foods','Morgan Lee','Qualified',1500,'Food & beverage','#8eaa51','Local catering partner with a student discount program.','Draft food sponsorship proposal',2],
    ['Atlas Systems','Alex Chen','Contacted',5000,'Technology','#638daa','Public university partnerships page. Strong interest in open-source education.','Check in with partnerships team',-2],
    ['Bloom Studio','Riley Brooks','Identified',1000,'Design','#bb8eae','Discovered through a past event sponsor page. Contact still needs verification.','Research partnership contact',3],
    ['Waypoint Ventures','Casey Park','Negotiating',4500,'Finance','#6e6a9e','Alumni introduction. Interested in judging and startup mentorship.','Review proposed benefits',1],
    ['Pinecone Coffee','Drew Wilson','Committed',1000,'Food & beverage','#987655','Local partner confirmed coffee budget for opening day.','Confirm delivery time',6],
    ['Bridge Analytics','Quinn Hall','Declined',2000,'Technology','#667b8c','Budget allocated this quarter. Revisit for the spring event.','Reconnect next semester',60],
    ['Fieldwork Robotics','Robin Reed','Qualified',3000,'Hardware','#69896c','Research lab spinout. Good fit for the hardware track.','Prepare mentoring and prize proposal',2],
    ['Summit Security','Dakota Gray','Identified',2500,'Security','#69896c','Found in a fictional campus security-club directory. No prior conversation; verify the partnerships contact before pitching.','Verify student outreach contact',3],
    ['Harbor Health','Reese Santos','Qualified',2000,'Health tech','#69896c','Mock alumni introduction confirmed interest in accessible health tools. Ask whether student projects or recruiting is the main goal.','Draft accessibility track proposal',2],
    ['Signal Mobile','Cameron Bell','Contacted',4000,'Telecommunications','#69896c','Sent a fictional connectivity proposal three days ago. Delivery receipt is recorded in the scenario; no reply yet. Silence does not establish interest.','Ask whether connectivity support fits',-1],
    ['Mosaic AI','Skyler Reed','Replied',5000,'AI','#69896c','Mock contact requested judging criteria and API usage estimates. No approved credit allocation yet. Send bounded usage assumptions and ask who approves credits.','Send API credit usage estimate',1],
    ['Red Oak Energy','Parker Diaz','Negotiating',3500,'Energy','#69896c','Mock sponsor wants a sustainability challenge. Budget is capped at $3,500; exclusivity remains unapproved. Offer a scoped challenge without promising exclusivity.','Review challenge scope with organizer',0],
    ['Meadow Books','Finley Ross','Committed',2500,'Education','#69896c','Fictional written commitment for $2,500; $1,500 received in the scenario. Confirm accessibility of learning materials and timing for the balance.','Confirm remaining payment date',4],
    ['Trailhead Travel','Rowan Blake','Declined',1500,'Travel','#69896c','Mock contact declined because this event falls outside their campaign window. Respect the decision; reconnect only with a relevant future event.','Revisit next semester if relevant',65],
    ['Lakeside Games','Elliot Shaw','Identified',2000,'Gaming','#69896c','Found through a fictional previous game-jam sponsor list. Developer community fit is plausible but unverified; no introduction is recorded.','Find community partnerships contact',4],
    ['Cobalt Data','Sage Turner','Qualified',3000,'Data tools','#69896c','Mock engineering-club referral verified a student program. Prepare a database workshop proposal and ask about mentor availability.','Draft workshop and mentor request',2],
    ['Acorn Education','Kendall Price','Contacted',1800,'Education','#69896c','Fictional email introduced the beginner track. Acknowledgment is not yet recorded; follow up once with a specific curriculum question.','Check beginner track sponsorship fit',-2],
    ['Ember Audio','Phoenix Ward','Replied',1200,'Hardware','#69896c','Mock contact offered equipment lending instead of cash. Confirm inventory, return terms, and delivery logistics before valuing an in-kind commitment.','Request equipment and loan terms',1],
    ['OpenWater Networks','Marley Hughes','Identified',4500,'Infrastructure','#69896c','Discovered through a fictional public university partnerships directory. Need the correct decision owner and confirmation that our event qualifies.','Verify university program eligibility',5],
    ['Spruce Media','Blair Foster','Qualified',1500,'Media','#69896c','Mock student-newspaper introduction established interest in event storytelling. Agree on measurable deliverables and retain organizer review of any announcement.','Draft event coverage package',3],
    ['Stonebridge Manufacturing','Emerson Cole','Committed',4500,'Manufacturing','#69896c','Fictional returning partner confirmed $4,500; $1,000 received. Mentor attendance is still being scheduled, independent of the cash commitment.','Confirm mentor roster and balance',6],
  ];
  const channels=['email','imessage','linkedin','email','email','imessage','linkedin','email','imessage','imessage','email','email','email','linkedin','imessage','email','email','linkedin','email','imessage','email','linkedin','imessage','email','email','imessage'];
  const sponsors = seed.map((s,i) => ({ id:`demo-${i+1}`, company:s[0],contact:s[1],stage:s[2],amount:s[3],category:s[4],color:s[5],notes:`Fictional scenario: ${s[6]}`,nextAction:s[7],nextDate:day(s[8]),owner:i%2?'Yash':'Alex Morgan',channel:channels[i],address:channels[i]==='imessage'?`+1202555${String(101+i).padStart(4,'0')}`:channels[i]==='linkedin'?`https://example.com/mock-linkedin/contact-${i+1}`:`partner${i+1}@example.com`,received:({0:4000,3:2000,17:1500,25:1000})[i]||0,source:`https://example.com/mock-leads/${s[0].toLowerCase().replaceAll(' ','-')}`,fit:`${s[4]} partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.` }));
  const users=[{phoneNumber:'+17344199492',name:'Campaign owner',email:'owner@example.com',details:{mock:true,role:'Campaign owner'},companyIds:sponsors.map(s=>s.id)}];
  const activities = sponsors.flatMap((s,i) => {
    const last = s.stage === 'Declined' ? 2 : STAGES.indexOf(s.stage);
    const path = STAGES.slice(0,last+1);
    if (s.stage === 'Declined') path.push('Declined');
    return path.map((stage,j) => ({ id:`activity-${i}-${j}`, sponsorId:s.id, company:s.company,kind:'stage',toStage:stage,fromStage:j?path[j-1]:null,text:j?`Moved to ${stage.toLowerCase()}`:'Added to the sponsor pipeline',actor:'Demo organizer',at:new Date(now.getTime()-(seed.length-i+3)*86400000+j*3600000).toISOString() }));
  }).sort((a,b)=>b.at.localeCompare(a.at));
  return { mode:'demo',ownerPhoneNumber:'+17344199492',demoVersion:DEMO_VERSION, event:{name:'BuildTogether 2026',date:day(42),location:'Ann Arbor, Michigan',attendees:350,goal:25000,pitch:'A weekend for 350 curious builders to turn ambitious ideas into projects that matter.',benefits:'Student recruiting, mentor sessions, track sponsorship, and event visibility.'},users,sponsors,activities,documents:[] };
}
