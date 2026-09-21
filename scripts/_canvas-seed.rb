# Seed realistic, course-appropriate assignments into the Docker Canvas sandbox.
# Creates via Canvas's OWN REST API (looped over localhost from inside the web
# container) — raw ActiveRecord inserts fail here because a Switchman global-id
# (root_account_id=1e13) gets injected outside a real request context. The API
# runs in a proper request, so root_account_id resolves to 1 correctly.
# Idempotent: every seeded assignment is tagged in `integration_id` ("navo-seed-N")
# and prior runs are deleted by that tag first. (A description HTML comment does
# NOT survive Canvas's sanitizer, so integration_id is the durable marker.)
# The admin token is minted in-memory and destroyed at the end — never printed.
require "net/http"; require "json"

TAG = "navo-seed"
WINDOW_START = Date.new(2026, 6, 15) # a Monday; ~11 days before "now" (2026-06-26) so a few land overdue
WEEKS = 8
$seq = 0

def at(d, hour)
  Time.utc(d.year, d.month, d.day, hour, 0, 0)
end

def html(s)
  "<p>#{s}</p>"
end

ADMIN = Account.find(1).account_users.active.first.user
TOK = ADMIN.access_tokens.create!(purpose: "navo-seed")

def api(method, path, form = nil)
  uri = URI("http://localhost#{path}")
  klass = { post: Net::HTTP::Post, delete: Net::HTTP::Delete, get: Net::HTTP::Get }[method]
  req = klass.new(uri)
  req["Authorization"] = "Bearer #{TOK.full_token}"
  req["Host"] = "canvas.docker"
  if form
    req["Content-Type"] = "application/x-www-form-urlencoded"
    req.body = URI.encode_www_form(form)
  end
  res = Net::HTTP.start(uri.hostname, uri.port) { |h| h.request(req) }
  [res.code.to_i, (JSON.parse(res.body) rescue nil)]
end

def create_assignment(course_id, group_id, name, desc, pts, due, subs)
  $seq += 1
  form = [
    ["assignment[name]", name],
    ["assignment[published]", "true"],
    ["assignment[points_possible]", pts.to_s],
    ["assignment[assignment_group_id]", group_id.to_s],
    ["assignment[integration_id]", "#{TAG}-#{$seq}"],
    ["assignment[description]", desc],
  ]
  subs.split(",").each { |s| form << ["assignment[submission_types][]", s] }
  form << ["assignment[due_at]", due.utc.iso8601] if due
  code, j = api(:post, "/api/v1/courses/#{course_id}/assignments", form)
  raise "create failed (#{code}) for #{name}: #{j.inspect[0, 160]}" unless code == 201
  j["id"]
end

# ---- topic progressions (one per week) ----
MICRO = ["Scarcity, Trade-offs & the PPF", "Supply & Demand", "Elasticity", "Consumer Choice & Utility",
         "Production & Costs", "Perfect Competition", "Monopoly & Market Power", "Oligopoly & Game Theory"]
FME   = ["Opportunity Recognition", "Customer Discovery", "The Business Model Canvas", "Building & Leading Teams",
         "Value Proposition & the MVP", "Go-to-Market & Marketing", "Financial Basics for Founders", "Delivering the Pitch"]
FIN   = ["Financial Statements & Cash Flow", "Time Value of Money", "Annuities & Loan Amortization", "Bond Valuation",
         "Stock Valuation", "Risk, Return & Diversification", "Cost of Capital", "Capital Budgeting (NPV & IRR)"]

# A slot = a recurring weekly assignment. wday 0=Mon..6=Sun.
# Combined across the 3 courses these cover every weekday ~2x → >=1/day, ~2/day avg.
def slots_for(course_key, topics)
  case course_key
  when :micro
    [
      { wday: 0, hour: 23, subs: "online_text_entry", pts: 10,
        name: ->(w){ "Reading Response: #{topics[w]}" },
        desc: ->(w){ html("Read this week's chapter on <strong>#{topics[w]}</strong>, then post a 150–200 word response: state the central idea in your own words and raise one question or a real-world example. Graded for completion + thoughtfulness.") } },
      { wday: 1, hour: 17, subs: "online_upload", pts: 30,
        name: ->(w){ "Problem Set #{w+1}: #{topics[w]}" },
        desc: ->(w){ html("Work the assigned end-of-chapter problems on <strong>#{topics[w]}</strong>. Draw and label all graphs, show every step, and submit a single PDF. Partial credit is given for shown work.") } },
      { wday: 2, hour: 23, subs: "online_text_entry", pts: 15,
        name: ->(w){ "Concept Check: #{topics[w]}" },
        desc: ->(w){ html("A short concept check on <strong>#{topics[w]}</strong>: answer the 5 posted short-answer prompts. Aim for 1–2 sentences each — precision over length.") } },
      { wday: 4, hour: 17, subs: "online_upload", pts: 25,
        name: ->(w){ "Applied Graph Exercise: #{topics[w]}" },
        desc: ->(w){ html("Using the dataset posted in Files, build and interpret the graph(s) for <strong>#{topics[w]}</strong>. Explain in a short paragraph what your graph shows and why it matters for the model.") } },
      { wday: 5, hour: 23, subs: "online_text_entry", pts: 10,
        name: ->(w){ "Weekly Reflection: #{topics[w]}" },
        desc: ->(w){ html("Reflect on where you saw <strong>#{topics[w]}</strong> show up in the news or your own life this week. One short paragraph.") } },
    ]
  when :fme
    [
      { wday: 1, hour: 23, subs: "online_text_entry", pts: 15,
        name: ->(w){ "Reading & Reflection: #{topics[w]}" },
        desc: ->(w){ html("Read the assigned case + chapter on <strong>#{topics[w]}</strong> and write a one-paragraph reflection: what surprised you, and how would you apply it to your venture?") } },
      { wday: 3, hour: 17, subs: "online_upload", pts: 50,
        name: ->(w){ "Venture Deliverable (Team): #{topics[w]}" },
        desc: ->(w){ html("With your team, produce this week's venture artifact for <strong>#{topics[w]}</strong> (e.g., interviews, a canvas, an MVP sketch). Submit one document and list each member's contribution.") } },
      { wday: 4, hour: 17, subs: "online_text_entry,online_upload", pts: 20,
        name: ->(w){ "Individual Task: #{topics[w]}" },
        desc: ->(w){ html("An individual exercise applying <strong>#{topics[w]}</strong> to your own venture idea. Submit a half-page write-up or a single slide.") } },
      { wday: 6, hour: 23, subs: "online_text_entry", pts: 10,
        name: ->(w){ "Prep for Next Session: #{topics[w]}" },
        desc: ->(w){ html("Skim next week's materials and come with one question. Post your question here before Monday's session.") } },
    ]
  when :fin
    [
      { wday: 0, hour: 17, subs: "online_upload", pts: 35,
        name: ->(w){ "Problem Set #{w+1}: #{topics[w]}" },
        desc: ->(w){ html("Solve the assigned problems on <strong>#{topics[w]}</strong>. Use a financial calculator or spreadsheet, and clearly show your inputs (rate, periods, cash flows) and the formula used for each. Submit one PDF.") } },
      { wday: 2, hour: 23, subs: "online_text_entry", pts: 15,
        name: ->(w){ "Concept Check: #{topics[w]}" },
        desc: ->(w){ html("Answer the short conceptual questions on <strong>#{topics[w]}</strong>. Explain the intuition, not just the formula.") } },
      { wday: 3, hour: 17, subs: "online_upload", pts: 30,
        name: ->(w){ "Spreadsheet Exercise: #{topics[w]}" },
        desc: ->(w){ html("Build the spreadsheet model for <strong>#{topics[w]}</strong> using the template in Files. Submit the .xlsx with formulas intact (not pasted values).") } },
      { wday: 5, hour: 23, subs: "online_upload", pts: 20,
        name: ->(w){ "Practice Set: #{topics[w]}" },
        desc: ->(w){ html("Extra practice problems on <strong>#{topics[w]}</strong> to prep for the next assessment. Submit your worked solutions.") } },
    ]
  end
end

# Assessments — at most one per 2 weeks per class. wday 3 = Thursday.
ASSESSMENTS = {
  micro: [ {week: 1, name: "Quiz 1: Supply & Demand", pts: 50, hour: 16, subs: "none",
             desc: "In-class quiz covering scarcity, the PPF, and supply & demand. Closed-note; bring a calculator. Review your problem sets and reading responses."},
           {week: 3, name: "Midterm Exam", pts: 150, hour: 16, subs: "none",
             desc: "In-class midterm covering Weeks 1–4 (scarcity through consumer choice). Closed-note, calculator allowed. Expect short answers, graphs, and 2 longer problems."},
           {week: 5, name: "Quiz 2: Costs & Competition", pts: 50, hour: 16, subs: "none",
             desc: "In-class quiz on production, costs, and perfect competition. Closed-note."},
           {week: 7, name: "Final Exam", pts: 200, hour: 16, subs: "none",
             desc: "Cumulative final exam. Emphasis on market structures (Weeks 5–8) but everything is fair game. Closed-note, calculator allowed."} ],
  fin:   [ {week: 2, name: "Midterm Exam", pts: 150, hour: 16, subs: "none",
             desc: "Midterm covering financial statements, time value of money, and annuities. Bring a financial calculator. Show inputs for every problem."},
           {week: 5, name: "Quiz: Valuation", pts: 60, hour: 16, subs: "none",
             desc: "Short exam on bond and stock valuation. Closed-note; financial calculator allowed."},
           {week: 7, name: "Final Exam", pts: 200, hour: 16, subs: "none",
             desc: "Cumulative final emphasizing risk/return, cost of capital, and capital budgeting (NPV/IRR). Financial calculator allowed."} ],
  fme:   [ {week: 3, name: "Midterm Pitch (Team)", pts: 120, hour: 16, subs: "online_upload",
             desc: "Your team delivers a 5-minute investor pitch + uploads the deck. Cover the problem, customer, solution, business model, and what you've validated so far."},
           {week: 6, name: "Venture Progress Review", pts: 80, hour: 16, subs: "online_upload",
             desc: "Individual write-up assessing your venture's progress against the milestones: what's working, what pivoted, and your plan for the final pitch."} ],
}

# Placeholder / non-actionable items — these SHOULD be screened out by the AI
# (passive grades the instructor enters; nothing to submit). High points on
# purpose, to confirm the screen keeps them from dominating the ranking.
PLACEHOLDERS = [
  { course: :micro, name: "Class Attendance", pts: 100, due: nil, subs: "none",
    desc: "Attendance is recorded by the instructor at each session. This is a placeholder for your attendance grade — <strong>you do not submit anything here.</strong>" },
  { course: :micro, name: "Points from Answering Questions in Class", pts: 50, due: 20, subs: "none",
    desc: "A placeholder the teaching team uses to enter points for participating in class discussion. Nothing to submit." },
  { course: :fme, name: "Peer Evaluation Score (instructor-entered)", pts: 100, due: 30, subs: "none",
    desc: "Your teammates' evaluation of your contribution, tallied and entered by the teaching team. <strong>No submission required.</strong>" },
  { course: :fin, name: "TopHat Participation", pts: 75, due: nil, subs: "none",
    desc: "Points from in-class TopHat polling, synced automatically. This is a placeholder column — <strong>do not submit anything.</strong>" },
]

COURSES = { micro: {id: 5, topics: MICRO}, fme: {id: 4, topics: FME}, fin: {id: 6, topics: FIN} }
GROUP = {}
COURSES.each { |k, c| GROUP[k] = Course.find(c[:id]).assignment_groups.active.first.id }

begin
  # --- wipe prior seed runs (matched by the integration_id tag) via API ---
  removed = 0
  COURSES.each_value do |cfg|
    Course.find(cfg[:id]).assignments.where("integration_id LIKE ?", "#{TAG}-%").pluck(:id).each do |aid|
      code, _ = api(:delete, "/api/v1/courses/#{cfg[:id]}/assignments/#{aid}")
      removed += 1 if code == 200
    end
  end
  puts "removed #{removed} prior seeded assignments"

  created = 0
  COURSES.each do |key, cfg|
    cid = cfg[:id]; gid = GROUP[key]; topics = cfg[:topics]
    slots_for(key, topics).each do |s|
      (0...WEEKS).each do |w|
        due = at(WINDOW_START + (w * 7) + s[:wday], s[:hour])
        create_assignment(cid, gid, s[:name].call(w), s[:desc].call(w), s[:pts], due, s[:subs])
        created += 1
      end
    end
    (ASSESSMENTS[key] || []).each do |x|
      due = at(WINDOW_START + (x[:week] * 7) + 3, x[:hour]) # Thursday
      create_assignment(cid, gid, x[:name], html(x[:desc]), x[:pts], due, x[:subs])
      created += 1
    end
  end
  PLACEHOLDERS.each do |p|
    cfg = COURSES[p[:course]]
    due = p[:due] ? at(WINDOW_START + p[:due], 23) : nil
    create_assignment(cfg[:id], GROUP[p[:course]], p[:name], html(p[:desc]), p[:pts], due, p[:subs])
    created += 1
  end
  puts "created #{created} assignments across #{COURSES.size} courses"

  # --- daily-density check over the window ---
  counts = Hash.new(0)
  COURSES.each_value do |cfg|
    Course.find(cfg[:id]).assignments.where("integration_id LIKE ?", "#{TAG}-%").where.not(due_at: nil).pluck(:due_at).each { |d| counts[d.to_date] += 1 }
  end
  days = (WINDOW_START..(WINDOW_START + WEEKS * 7 - 1)).to_a
  withitem = days.count { |d| counts[d] > 0 }
  total = counts.values.sum
  puts "density: #{total} dated items over #{days.size} days = #{(total.to_f / days.size).round(2)}/day; days with >=1: #{withitem}/#{days.size}; min/day=#{days.map { |d| counts[d] }.min}, max/day=#{days.map { |d| counts[d] }.max}"
ensure
  TOK.destroy
end
