/* Family Information Book: field definitions. Single source for the form, the dashboard and the Excel template. */
var APP_NAME = 'Family Information Book';
var KEY = 'family-information-book-india-v2';
var CHECK_DAYS = 60;      // dates within this many days (or overdue) are listed on the dashboard
var STALE_DAYS = 90;      // balances not updated for this long are flagged

var REL = ['Self','Spouse','Son','Daughter','Father','Mother','Brother','Sister','Son-in-law','Daughter-in-law','Friend','Neighbour','HUF','Firm / business','Other'];
var BLOOD = ['A+','A-','B+','B-','AB+','AB-','O+','O-','Not known'];
var YN = ['Yes','No'];
var FREQ = ['Monthly','Quarterly','Half-yearly','Yearly','One-time'];
var INSFREQ = ['Monthly','Quarterly','Half-yearly','Yearly','Single premium'];
var PERYEAR = {'Monthly':12,'Quarterly':4,'Half-yearly':2,'Yearly':1,'One-time':0,'Single premium':0};
var KEYCATS = ['Police station','Hospital (emergency)','Family doctor','Trusted neighbour','Building security / society office','Chartered Accountant (CA)','Lawyer','Employer / HR','Insurance agent','Bank branch manager','Other'];
var ENTITY = ['Individual','HUF','Proprietorship','Partnership firm','LLP','Company','Other'];
var HOLDING = ['Single','Joint'];
var PORTAL = ['Yes','No','Not sure'];
var INSSTATUS = ['Active','Paid-up','Matured','Lapsed','Closed','Not sure'];
var ACCT = ['Savings','Current','Salary','NRI','Other'];
var DEP = ['Fixed deposit (FD)','Recurring deposit (RD)','Post Office deposit','Other'];
var INV = ['Mutual fund','SIP','Shares / Demat','PPF','EPF','NPS','Gold / SGB','Bonds / NSC / KVP','Other'];
var SIPACT = ['Continue','Stop','Review','Not applicable'];
var INS = ['Life / LIC','Term plan','Health','Motor (car / bike)','Travel / accident','Other'];
var PROP = ['Flat / apartment','House','Plot / land','Shop / office','Agricultural land','Other'];
var MUT = ['Done','Pending','Not sure'];
var LOANT = ['Home loan','Car loan','Personal loan','Education loan','Credit card','Business loan','Other'];
var LOANACT = ['Continue as usual','Prepay','Close loan','Needs decision'];
var BILLCAT = ['Electricity','Gas (LPG / piped)','Water','Mobile / broadband','Society maintenance','Subscriptions / OTT','Insurance premium','Other'];
var BILLACT = ['Continue','Cancel','Review'];
var DOCT = ['Aadhaar','PAN','Passport','Driving licence','Voter ID','Birth certificate','Marriage certificate','Will','Power of attorney','Property papers','Tax returns (ITR)','Other'];
var DOCST = ['Original','Copy','Digital copy','Not available'];
var NOMA = ['Bank account','FD / RD','Mutual fund','Shares / Demat','PPF','EPF','NPS','Life insurance','Locker','Other'];
var NOMS = ['Verified','Needs update','Not nominated'];
var RECOV = ['Set up','Not set up','Not sure'];
var WILL = ['Yes','No','Not sure'];

var BLOCKS = [
{id:'me',g:'family',kind:'single',title:'About me',hint:'The person this book belongs to. Printed on the emergency card.',fields:[
  {k:'name',l:'Full name',t:'text'},
  {k:'dob',l:'Date of birth',t:'date'},
  {k:'blood',l:'Blood group',t:'sel',o:BLOOD},
  {k:'phone',l:'Mobile number',t:'tel'},
  {k:'address',l:'Home address',t:'area',wide:true}
]},
{id:'family',g:'family',kind:'table',title:'Family members',hint:'Spouse, children, parents, or anyone who depends on you.',fields:[
  {k:'name',l:'Full name',t:'text'},
  {k:'rel',l:'Relation',t:'sel',o:REL},
  {k:'entityType',l:'Person / business type',t:'sel',o:ENTITY},
  {k:'dob',l:'Date of birth',t:'date'},
  {k:'blood',l:'Blood group',t:'sel',o:BLOOD},
  {k:'phone',l:'Mobile number',t:'tel'}
]},
{id:'contacts',g:'family',kind:'table',title:'Emergency contacts',hint:'The first two people with a phone number are printed on the emergency card.',fields:[
  {k:'name',l:'Name',t:'text'},
  {k:'rel',l:'Relation',t:'sel',o:REL},
  {k:'phone',l:'Phone',t:'tel'},
  {k:'alt',l:'Alternative phone',t:'tel'}
]},
{id:'keys',g:'family',kind:'table',title:'Key contacts',hint:'Police station, hospital, doctor, neighbour, CA, lawyer, employer and insurance agent.',fields:[
  {k:'cat',l:'Type',t:'sel',o:KEYCATS},
  {k:'name',l:'Name',t:'text'},
  {k:'phone',l:'Phone',t:'tel'},
  {k:'notes',l:'Address or note',t:'text'}
]},

{id:'bank',g:'money',kind:'table',title:'Bank accounts',hint:'Only the last 4 digits of each account number. Enter the balance and the date you checked it.',fields:[
  {k:'holder',l:'Holder name',t:'member'},
  {k:'bank',l:'Bank name',t:'text'},
  {k:'branch',l:'Branch',t:'text'},
  {k:'type',l:'Account type',t:'sel',o:ACCT},
  {k:'holding',l:'Holding',t:'sel',o:HOLDING},
  {k:'jointHolder',l:'Joint holder name',t:'member',when:{k:'holding',eq:'Joint'}},
  {k:'last4',l:'Last 4 digits',t:'text'},
  {k:'balance',l:'Balance (₹)',t:'num'},
  {k:'asOf',l:'Balance as on',t:'date'},
  {k:'nomReg',l:'Nominee added?',t:'sel',o:YN},
  {k:'nominee',l:'Nominee name',t:'member',allowOther:true,when:{k:'nomReg',eq:'Yes'}},
  {k:'nomineeOther',l:'Other nominee name',t:'text',when:{k:'nominee',eq:'Other person'}},
  {k:'locker',l:'Has a locker?',t:'sel',o:YN},
  {k:'lockerNo',l:'Locker number',t:'text',when:{k:'locker',eq:'Yes'}}
]},
{id:'fd',g:'money',kind:'table',title:'Fixed and recurring deposits',hint:'One row per deposit. Maturity dates appear on the dashboard.',fields:[
  {k:'holder',l:'Holder name',t:'member'},
  {k:'holding',l:'Holding',t:'sel',o:HOLDING},
  {k:'jointHolder',l:'Joint holder name',t:'member',when:{k:'holding',eq:'Joint'}},
  {k:'bank',l:'Bank or post office',t:'text'},
  {k:'type',l:'Type',t:'sel',o:DEP},
  {k:'amount',l:'Amount deposited (₹)',t:'num'},
  {k:'rate',l:'Interest rate (%)',t:'num'},
  {k:'start',l:'Start date',t:'date'},
  {k:'maturity',l:'Maturity date',t:'date',alert:true},
  {k:'nomReg',l:'Nominee added?',t:'sel',o:YN},
  {k:'nominee',l:'Nominee name',t:'member',allowOther:true,when:{k:'nomReg',eq:'Yes'}},
  {k:'nomineeOther',l:'Other nominee name',t:'text',when:{k:'nominee',eq:'Other person'}},
  {k:'asOf',l:'Value as on',t:'date'},
  {k:'where',l:'Receipt kept at',t:'text'}
]},
{id:'inv',g:'money',kind:'table',title:'Investments and SIPs',hint:'Current approximate value and the date you checked it. SIP amount is per month.',fields:[
  {k:'holder',l:'Holder name',t:'member'},
  {k:'holding',l:'Holding',t:'sel',o:HOLDING},
  {k:'jointHolder',l:'Joint holder name',t:'member',when:{k:'holding',eq:'Joint'}},
  {k:'type',l:'Type',t:'sel',o:INV},
  {k:'where',l:'Institution or broker',t:'text'},
  {k:'ref',l:'Folio or account (last 4)',t:'text'},
  {k:'value',l:'Current value (₹)',t:'num'},
  {k:'asOf',l:'Value as on',t:'date'},
  {k:'sip',l:'SIP per month (₹)',t:'num'},
  {k:'sipAct',l:'SIP: continue or stop?',t:'sel',o:SIPACT},
  {k:'nomReg',l:'Nominee added?',t:'sel',o:YN},
  {k:'nominee',l:'Nominee name',t:'member',allowOther:true,when:{k:'nomReg',eq:'Yes'}},
  {k:'nomineeOther',l:'Other nominee name',t:'text',when:{k:'nominee',eq:'Other person'}}
]},

{id:'ins',g:'ins',kind:'table',title:'Insurance policies',hint:'Premium per payment. Maturity date may be estimated from the start date and term; please check the policy document.',fields:[
  {k:'holder',l:'Policyholder name',t:'member'},
  {k:'insured',l:'Insured person name',t:'member'},
  {k:'type',l:'Insurance type',t:'sel',o:INS},
  {k:'company',l:'Insurance company',t:'text'},
  {k:'ref',l:'Policy number (last 4)',t:'text'},
  {k:'plan',l:'Plan name',t:'text'},
  {k:'sum',l:'Sum assured (₹)',t:'num'},
  {k:'premium',l:'Premium (₹)',t:'num'},
  {k:'freq',l:'Premium mode',t:'sel',o:INSFREQ},
  {k:'start',l:'Policy start date',t:'date'},
  {k:'term',l:'Policy term (years)',t:'num'},
  {k:'payTerm',l:'Premium paying years',t:'num'},
  {k:'lastPaid',l:'Last premium paid on',t:'date'},
  {k:'due',l:'Next premium due',t:'date',alert:true},
  {k:'maturity',l:'Maturity / expiry date',t:'date',alert:true},
  {k:'portal',l:'Registered online?',t:'sel',o:PORTAL},
  {k:'nomReg',l:'Nominee added?',t:'sel',o:YN},
  {k:'nominee',l:'Nominee name',t:'member',allowOther:true,when:{k:'nomReg',eq:'Yes'}},
  {k:'nomineeOther',l:'Other nominee name',t:'text',when:{k:'nominee',eq:'Other person'}},
  {k:'nomineeRel',l:'Nominee relation to policyholder',t:'text',when:{k:'nomReg',eq:'Yes'}},
  {k:'status',l:'Policy status',t:'sel',o:INSSTATUS},
  {k:'agent',l:'Agent name',t:'text'},
  {k:'agentPhone',l:'Agent phone',t:'tel'},
  {k:'where',l:'Policy paper kept at',t:'text'}
]},

{id:'prop',g:'home',kind:'table',title:'Property',hint:'Flats, houses, plots and shops.',fields:[
  {k:'holder',l:'Owner name',t:'member'},
  {k:'holding',l:'Holding',t:'sel',o:HOLDING},
  {k:'jointHolder',l:'Joint owner name',t:'member',when:{k:'holding',eq:'Joint'}},
  {k:'type',l:'Type',t:'sel',o:PROP},
  {k:'address',l:'Address',t:'text'},
  {k:'owners',l:'Other ownership details',t:'text'},
  {k:'mutation',l:'Name changed in records?',t:'sel',o:MUT},
  {k:'where',l:'Title papers kept at',t:'text'}
]},
{id:'veh',g:'home',kind:'table',title:'Vehicles',hint:'Expiry dates appear on the dashboard before they run out.',fields:[
  {k:'holder',l:'Registered owner',t:'member'},
  {k:'model',l:'Make and model',t:'text'},
  {k:'reg',l:'Registration number',t:'text'},
  {k:'rcNo',l:'RC number (last 4)',t:'text'},
  {k:'insExp',l:'Insurance expiry',t:'date',alert:true},
  {k:'pucExp',l:'PUC expiry',t:'date',alert:true},
  {k:'where',l:'RC book and papers kept at',t:'text'}
]},
{id:'loan',g:'home',kind:'table',title:'Loans and EMIs',hint:'Monthly EMIs are added up automatically.',fields:[
  {k:'holder',l:'Borrower name',t:'member'},
  {k:'coBorrower',l:'Co-borrower (if any)',t:'member'},
  {k:'lender',l:'Lender',t:'text'},
  {k:'type',l:'Loan type',t:'sel',o:LOANT},
  {k:'emi',l:'EMI per month (₹)',t:'num'},
  {k:'outstanding',l:'Balance left (₹)',t:'num'},
  {k:'asOf',l:'Balance as on',t:'date'},
  {k:'next',l:'Next EMI date',t:'date',alert:true},
  {k:'action',l:'What to do',t:'sel',o:LOANACT},
  {k:'phone',l:'Lender phone',t:'tel'}
]},
{id:'bill',g:'home',kind:'table',title:'Bills and subscriptions',hint:'Electricity, gas, phone, maintenance, OTT and other recurring payments. Monthly equivalent is calculated.',fields:[
  {k:'holder',l:'Account holder',t:'member'},
  {k:'name',l:'Bill or service',t:'text'},
  {k:'cat',l:'Category',t:'sel',o:BILLCAT},
  {k:'amount',l:'Amount (₹)',t:'num'},
  {k:'freq',l:'How often',t:'sel',o:FREQ},
  {k:'next',l:'Next due date',t:'date',alert:true},
  {k:'auto',l:'Auto-debit on?',t:'sel',o:YN},
  {k:'action',l:'Keep or cancel?',t:'sel',o:BILLACT}
]},

{id:'docs',g:'papers',kind:'table',title:'Important papers',hint:'Record where each original is kept. Do not upload copies here.',fields:[
  {k:'type',l:'Document',t:'sel',o:DOCT},
  {k:'holder',l:'Whose name',t:'member'},
  {k:'status',l:'Status',t:'sel',o:DOCST},
  {k:'where',l:'Where it is kept',t:'text'},
  {k:'expiry',l:'Expiry date (if any)',t:'date',alert:true}
]},
{id:'nom',g:'papers',kind:'table',title:'Nomination master list',hint:'One line for every account, policy or locker that has a nominee.',fields:[
  {k:'holder',l:'Holder name',t:'member'},
  {k:'asset',l:'Asset',t:'sel',o:NOMA},
  {k:'ref',l:'Account or policy (last 4)',t:'text'},
  {k:'nominee',l:'Nominee name',t:'member',allowOther:true},
  {k:'nomineeOther',l:'Other nominee name',t:'text',when:{k:'nominee',eq:'Other person'}},
  {k:'rel',l:'Relation',t:'sel',o:REL},
  {k:'share',l:'Share (%)',t:'num'},
  {k:'verified',l:'Last checked on',t:'date'},
  {k:'status',l:'Status',t:'sel',o:NOMS}
]},
{id:'other',g:'papers',kind:'table',title:'Other records',hint:'Anything else important that does not fit above.',fields:[
  {k:'name',l:'Record',t:'text'},
  {k:'holder',l:'Whose',t:'member'},
  {k:'where',l:'Where it is kept',t:'text'},
  {k:'notes',l:'Notes',t:'text'}
]},

{id:'medical',g:'health',kind:'single',title:'Medical information',hint:'Shared only with people who will look after you.',fields:[
  {k:'conditions',l:'Medical conditions',t:'area',wide:true},
  {k:'allergies',l:'Allergies',t:'area',wide:true},
  {k:'medicines',l:'Regular medicines',t:'area',wide:true},
  {k:'doctor',l:'Family doctor',t:'text'},
  {k:'doctorPhone',l:'Doctor phone',t:'tel'},
  {k:'hospital',l:'Preferred hospital',t:'text'}
]},
{id:'dig',g:'health',kind:'table',title:'Online accounts',hint:'Never write passwords, PINs or OTPs here. Only note where the access arrangement is kept.',fields:[
  {k:'holder',l:'Account owner',t:'member'},
  {k:'service',l:'Service (e.g. email, bank app)',t:'text'},
  {k:'login',l:'Login email or phone',t:'text'},
  {k:'recovery',l:'Recovery set up?',t:'sel',o:RECOV},
  {k:'legacy',l:'Trusted person can access?',t:'sel',o:YN},
  {k:'where',l:'Access arrangement kept at',t:'text'}
]},

{id:'plan',g:'plan',kind:'single',title:'What the family should do',hint:'Write this so a family member can act without you. Keep it short.',fields:[
  {k:'firstCall',l:'Call first (name and number)',t:'text',wide:true,ph:'e.g. Ravi (son), 98xxxxxx21'},
  {k:'keysLoc',l:'Where the house and locker keys are',t:'text',wide:true},
  {k:'lockerLoc',l:'Where important papers and locker are',t:'area',wide:true},
  {k:'recovery',l:'How email and phone recovery works (no passwords)',t:'area',wide:true},
  {k:'will',l:'Is there a will?',t:'sel',o:WILL},
  {k:'willLoc',l:'Where the will is kept',t:'text'},
  {k:'steps',l:'Immediate steps for family',t:'area',wide:true,ph:'1. Call the CA\n2. Inform the employer HR\n3. Find the policy papers'},
  {k:'message',l:'Message to family (optional)',t:'area',wide:true}
]}
];

var GROUPS = [
  {id:'dash',title:'Dashboard'},
  {id:'family',title:'Family and contacts'},
  {id:'money',title:'Bank and investments'},
  {id:'ins',title:'Insurance'},
  {id:'home',title:'Home, loans and bills'},
  {id:'papers',title:'Papers and nominees'},
  {id:'health',title:'Health and online accounts'},
  {id:'plan',title:'If something happens'},
  {id:'help',title:'India help and checklist'},
  {id:'card',title:'Emergency card'}
];

var CHECKLIST = [
  'Call the first emergency contact and the CA',
  'Inform the employer or HR department',
  'Find the will, policy papers and locker key',
  'Ask the hospital or doctor for the death summary',
  'Apply for the death certificate through the local registrar',
  'Inform banks, insurers and lenders',
  'Do not stop any EMI, SIP or insurance premium without written confirmation',
  'Keep a notebook of every call, reference number and date'
];

var PROCS = [
  {t:'Death certificate',s:[
    'Register the death with the local registrar of births and deaths (municipal corporation or gram panchayat).',
    'Many states allow online applications through the Civil Registration System portal.',
    'Keep the hospital death summary and the deceased’s ID ready. Get several certified copies.'],
    l:['Civil Registration System: crsorgi.gov.in','https://www.crsorgi.gov.in']},
  {t:'Life insurance claim',s:[
    'Tell the insurer quickly through its branch, customer care or website, and ask for the claim form and checklist.',
    'Usual papers: policy document (or copy), death certificate, claimant’s ID and bank proof, and the nominee’s KYC.',
    'If there is no valid nominee, the insurer may ask for legal heir or succession papers.']},
  {t:'EPF and pension (EPFO)',s:[
    'The nominee or legal heir makes the claim through the EPFO member portal or at an EPFO office.',
    'Papers usually needed: death certificate, bank details with proof, and nominee or legal heir details.',
    'Pension (EPS) and insurance (EDLI) benefits are claimed separately. Check the UAN and nominee details first.'],
    l:['EPFO member portal: epfindia.gov.in','https://www.epfindia.gov.in']},
  {t:'Bank account of a person who has died',s:[
    'Inform the branch and ask for its claim process.',
    'If there is a nominee, the nominee submits the claim form, death certificate and KYC.',
    'If there is no nominee, the bank will usually ask for a legal heir or succession certificate, as per its policy.',
    'Unclaimed deposits can be traced on the RBI’s UDGAM portal.'],
    l:['UDGAM (unclaimed deposits): udgam.rbi.org.in','https://udgam.rbi.org.in']},
  {t:'Mutual funds and shares',s:[
    'For mutual fund folios, the nominee or legal heir sends a transmission request to the fund house or its registrar (CAMS or KFintech).',
    'For demat shares, the nominee or legal heir follows the transmission process of the broker or depository.',
    'Keep folio numbers, demat details and nomination proof ready.']},
  {t:'Property name change (mutation)',s:[
    'Apply to the municipal or revenue office where the property is located.',
    'Usually needed: death certificate, title deed, property tax receipts, and the will or legal heir papers.',
    'Mutation updates the records. It does not by itself decide legal ownership. Consult a lawyer if there is a dispute.']},
  {t:'Vehicles',s:[
    'Transfer ownership through the RTO, following your state’s rules. Vehicle records are on Parivahan.',
    'Keep the RC book, insurance and PUC papers together, and inform the insurer.'],
    l:['Parivahan (vehicle records): parivahan.gov.in','https://parivahan.gov.in']},
  {t:'Loans and EMIs',s:[
    'Tell the lender at once and ask for the loan statement and claim process.',
    'Do not stop EMIs without written confirmation from the lender.',
    'Some loans have credit-linked life cover. Ask the lender whether it applies.']},
  {t:'Income tax',s:[
    'The legal heir or representative can handle tax matters. Check the Annual Information Statement (AIS) for the year.',
    'Keep receipts and ask your CA about pending returns or refunds.'],
    l:['Income Tax e-filing portal: incometax.gov.in','https://www.incometax.gov.in']}
];

if (typeof module !== 'undefined') module.exports = {BLOCKS: BLOCKS, PERYEAR: PERYEAR};
