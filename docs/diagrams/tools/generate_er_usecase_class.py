"""Regenerate the CampusSeat draw.io sources for check-in, categories, saved events and self-service."""
import os, re
from xml.sax.saxutils import escape
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'source')

def q(v): return escape(v, {'"': '&quot;'})

# ---------------- ER ----------------
ENT = 'swimlane;fontStyle=1;horizontal=1;startSize=28;collapsible=0;html=1;fontSize=13;'
ATTR = 'text;html=1;align=left;verticalAlign=middle;spacingLeft=8;fontSize=12;strokeColor=none;fillColor=none;'
REL = 'html=1;rounded=0;startArrow={s};endArrow={e};startSize=14;endSize=14;fontSize=11;labelBackgroundColor=default;'
cells, nid = [], [200]
def entity(eid, name, x, y, attrs, w=220):
    h = 28 + 24 * len(attrs)
    cells.append(f'<mxCell id="{eid}" value="{q(name)}" style="{ENT}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    for i, a in enumerate(attrs):
        nid[0] += 1
        pk = '(PK' in a
        cells.append(f'<mxCell id="a{nid[0]}" value="{q(a)}" style="{ATTR}{"fontStyle=4;" if pk else ""}" vertex="1" parent="{eid}"><mxGeometry y="{28 + 24 * i}" width="{w}" height="24" as="geometry"/></mxCell>')
def rel(rid, label, src, dst, s='ERmandOne', e='ERzeroToMany'):
    cells.append(f'<mxCell id="{rid}" value="{q(label)}" style="{REL.format(s=s, e=e)}" edge="1" parent="1" source="{src}" target="{dst}"><mxGeometry relative="1" as="geometry"/></mxCell>')

def rel2(rid, label, src, dst, s='ERmandOne', e='ERzeroToMany', exit=None, entry=None, points=()):
    st = REL.format(s=s, e=e)
    if exit: st += f'exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;'
    if entry: st += f'entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;'
    pts = ''.join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in points)
    geo = f'<mxGeometry relative="1" as="geometry"><Array as="points">{pts}</Array></mxGeometry>' if points else '<mxGeometry relative="1" as="geometry"/>'
    cells.append(f'<mxCell id="{rid}" value="{q(label)}" style="{st}" edge="1" parent="1" source="{src}" target="{dst}">{geo}</mxCell>')

# Layout: User left, Event right, the tables they share stacked in the middle column (no crossings).
entity('School', 'School', 330, 30, ['school_id (PK)', 'school_name (unique)'])
entity('EventSchool', 'EventSchool', 1030, 30, ['event_id (PK, FK)', 'school_id (PK, FK)'])
entity('User', 'User', 330, 210, ['user_id (PK)', 'full_name', 'student_number (unique)', 'email (unique)', 'password_hash', 'school_id (FK)', 'role', 'failed_logins', 'locked_until', 'totp_enabled_at', 'created_at'])
entity('Event', 'Event', 1030, 210, ['event_id (PK)', 'title', 'category', 'description', 'venue', 'event_date', 'start_time', 'end_time', 'starts_at (UTC)', 'ends_at (UTC)', 'capacity', 'created_by (FK)', 'created_at'])
entity('AuditLog', 'AuditLog', 20, 210, ['log_id (PK)', 'user_id (FK)', 'actor_email', 'action', 'entity_type', 'entity_id', 'details', 'before_json', 'after_json', 'ip', 'request_id', 'logged_at'], w=200)
entity('SavedEvent', 'SavedEvent', 680, 230, ['user_id (PK, FK)', 'event_id (PK, FK)', 'created_at'])
entity('Waitlist', 'WaitlistEntry', 680, 390, ['waitlist_id (PK)', 'event_id (FK)', 'user_id (FK)', 'status', 'created_at', 'promoted_booking_id'])
entity('Booking', 'Booking', 680, 640, ['booking_id (PK)', 'booking_ref (unique)', 'user_id (FK)', 'event_id (FK)', 'booked_at'])
entity('CheckIn', 'CheckIn', 680, 860, ['booking_id (PK, FK)', 'checked_in_at', 'checked_in_by (FK)'])
rel2('r1', 'has', 'School', 'User')
rel2('r2', 'allowed at', 'School', 'EventSchool')
rel2('r3', 'allows', 'Event', 'EventSchool')
rel2('r4', 'performs', 'User', 'AuditLog', s='ERzeroToOne', exit=(0, 0.4), entry=(1, 0.4))
rel2('r5', 'saves', 'User', 'SavedEvent', exit=(1, 0.15), entry=(0, 0.5))
rel2('r6', 'saved as', 'Event', 'SavedEvent', exit=(0, 0.13), entry=(1, 0.5))
rel2('r7', 'joins', 'User', 'Waitlist', exit=(1, 0.55), entry=(0, 0.5))
rel2('r8', 'queues', 'Event', 'Waitlist', exit=(0, 0.5), entry=(1, 0.5))
rel2('r9', 'makes', 'User', 'Booking', exit=(0.75, 1), entry=(0.2, 0))
rel2('r10', 'receives', 'Event', 'Booking', exit=(0.25, 1), entry=(0.8, 0))
rel2('r11', 'used at door', 'Booking', 'CheckIn', e='ERzeroToOne')
rel2('r12', 'checks in', 'User', 'CheckIn', s='ERzeroToOne', exit=(0.25, 1), entry=(0, 0.5), points=((385, 910),))
rel2('r13', 'creates', 'User', 'Event', exit=(0.85, 0), entry=(0.15, 0), points=((517, 160), (1063, 160)))
cells.append('<mxCell id="note" value="Login and security tables (sessions, password_resets, login_challenges, backup_codes, schema_migrations) are listed in Database_Schema.md." style="text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;fontSize=11;fontStyle=2;fontColor=#555555;" vertex="1" parent="1"><mxGeometry x="20" y="560" width="200" height="80" as="geometry"/></mxCell>')
er = ('<mxfile host="app.diagrams.net"><diagram name="ER Diagram" id="campusseat-er"><mxGraphModel dx="1400" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1280" pageHeight="1000" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
      + ''.join(cells) + '</root></mxGraphModel></diagram></mxfile>\n')
open(os.path.join(SRC, 'CampusSeat_ER.drawio'), 'w', encoding='utf-8').write(er)

# ---------------- Use case ----------------
UC = 'ellipse;whiteSpace=wrap;html=1;fontSize=11;'
NEW = 'ellipse;whiteSpace=wrap;html=1;fontSize=11;fillColor=#dae8fc;strokeColor=#6c8ebf;'
LINE = 'endArrow=none;html=1;rounded=0;'
DEP = 'dashed=1;endArrow=open;endFill=0;html=1;rounded=0;labelBackgroundColor=default;fontSize=10;'
c = ['<mxCell id="2" value="CampusSeat" style="rounded=0;whiteSpace=wrap;html=1;fillColor=none;verticalAlign=top;fontStyle=1;fontSize=16;" vertex="1" parent="1"><mxGeometry x="220" y="40" width="760" height="1060" as="geometry"/></mxCell>',
     '<mxCell id="3" value="User" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="80" y="520" width="30" height="60" as="geometry"/></mxCell>',
     '<mxCell id="4" value="Admin" style="shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="1100" y="520" width="30" height="60" as="geometry"/></mxCell>']
def uc(i, label, x, y, new=False):
    c.append(f'<mxCell id="{i}" value="{q(label)}" style="{NEW if new else UC}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="180" height="54" as="geometry"/></mxCell>')
def link(i, a, b, label='', style=LINE):
    c.append(f'<mxCell id="{i}" value="{label}" style="{style}" edge="1" parent="1" source="{a}" target="{b}"><mxGeometry relative="1" as="geometry"/></mxCell>')
user = [('Register', 0), ('Log in', 0), ('Log out', 0), ('Reset password', 0), ('Browse events', 0), ('Search/filter events (by type)', 1),
        ('Book a seat', 0), ('Download registration card', 0), ('View my bookings', 0), ('Cancel booking', 0), ('Join waitlist', 0),
        ('Save event for later', 1), ('Edit my details', 1), ('Show ticket offline', 1)]
for n, (label, new) in enumerate(user):
    uc(f'u{n}', label, 250, 90 + 70 * n, bool(new)); link(f'lu{n}', '3', f'u{n}', style=LINE + 'entryX=0;entryY=0.5;entryDx=0;entryDy=0;')
admin = [('Create event (with type)', 1), ('Set school restriction', 0), ('Edit event', 0), ('Delete event', 0), ('View bookings per event', 0),
         ('Manage users', 0), ('Generate reports (with attendance)', 1), ('View audit logs', 0), ('Check in attendee', 1), ('Undo check-in', 1)]
for n, (label, new) in enumerate(admin):
    uc(f'a{n}', label, 770, 90 + 70 * n, bool(new)); link(f'la{n}', '4', f'a{n}', style=LINE + 'entryX=1;entryY=0.5;entryDx=0;entryDy=0;')
uc('i0', 'Check seat availability', 510, 460); uc('i1', 'Verify school eligibility', 510, 530); uc('i2', 'Generate registration card', 510, 600)
uc('i4', 'Scan QR code', 510, 672, True); uc('i3', 'Verify booking, event and time window', 510, 770, True)
for n in range(3): link(f'inc{n}', 'u6', f'i{n}', '&#171;include&#187;', DEP)
link('inc3', 'a8', 'i3', '&#171;include&#187;', DEP)
link('ext0', 'a1', 'a0', '&#171;extend&#187;', DEP)
link('ext1', 'a9', 'a8', '&#171;extend&#187;', DEP)
link('ext2', 'i4', 'a8', '&#171;extend&#187;', DEP)
c.append('<mxCell id="gen" value="Admin is a User (inherits all user use cases)" style="endArrow=block;endFill=0;endSize=12;html=1;rounded=0;fontSize=11;labelBackgroundColor=default;" edge="1" parent="1" source="4" target="3"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1115" y="1150"/><mxPoint x="95" y="1150"/></Array></mxGeometry></mxCell>')
c.append('<mxCell id="key" value="Shaded: added Nov 2026" style="text;html=1;align=left;fontSize=11;fontStyle=2;fontColor=#555555;" vertex="1" parent="1"><mxGeometry x="240" y="1060" width="200" height="24" as="geometry"/></mxCell>')
ucx = ('<mxfile host="app.diagrams.net"><diagram name="Use Case Diagram" id="campusseat-usecase"><mxGraphModel dx="1400" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="1200" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
       + ''.join(c) + '</root></mxGraphModel></diagram></mxfile>\n')
open(os.path.join(SRC, 'CampusSeat_UseCase.drawio'), 'w', encoding='utf-8').write(ucx)

# ---------------- Class diagram (patch in place) ----------------
p = os.path.join(SRC, 'CampusSeat_ClassDiagram.drawio')
s = open(p, encoding='utf-8').read()
if 'CheckInService' in s:
    print('class diagram already patched'); raise SystemExit
def sub(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new, 1)
def grow(cell_id, by):
    """Increase a cell's height (and its container's) by `by` pixels."""
    global s
    m = re.search(r'(<mxCell id="%s"[^>]*>\s*<mxGeometry height=")(\d+)' % cell_id, s)
    s = s[:m.start(2)] + str(int(m.group(2)) + by) + s[m.end(2):]
def shift(cell_id, by):
    global s
    m = re.search(r'(<mxCell id="%s"[^>]*>\s*<mxGeometry height="\d+" width="\d+" )y="(\d+)"' % cell_id, s)
    s = s[:m.start(2)] + str(int(m.group(2)) + by) + s[m.end(2):]
L = 18
# User: two new operations
sub('+resetPassword()&lt;br&gt;+viewMyBookings()', '+resetPassword()&lt;br&gt;+viewMyBookings()&lt;br&gt;+editProfile(name, number, school)&lt;br&gt;+saveEvent(event)')
grow('c18', 2 * L); grow('c15', 2 * L)
# Admin: check-in
sub('+manageUsers()&lt;br&gt;+generateReport()', '+manageUsers()&lt;br&gt;+generateReport()&lt;br&gt;+checkIn(reference)&lt;br&gt;+undoCheckIn(booking)')
grow('c30', 2 * L); grow('c27', 2 * L)
# Booking: check-in time
sub('-bookingDate: datetime&lt;br&gt;-status: string', '-bookingDate: datetime&lt;br&gt;-status: string&lt;br&gt;-checkedInAt: datetime')
grow('c20', L); grow('c19', L); shift('c21', L); shift('c22', L)
sub('+confirm()&lt;br&gt;+cancel()&lt;br&gt;+getReference()', '+confirm()&lt;br&gt;+cancel()&lt;br&gt;+getReference()&lt;br&gt;+isCheckedIn(): bool')
grow('c22', L); grow('c19', L)
# Event: category and UTC times
sub('-eventId: int&lt;br&gt;-title: string', '-eventId: int&lt;br&gt;-title: string&lt;br&gt;-category: string')
sub('-startTime: time&lt;br&gt;', '-startTime: time&lt;br&gt;-startsAt / endsAt: datetime (UTC)&lt;br&gt;')
grow('c32', 2 * L); grow('c31', 2 * L); shift('c33', 2 * L); shift('c34', 2 * L)
sub('+reduceSeats()&lt;br&gt;+getDetails()', '+reduceSeats()&lt;br&gt;+getDetails()&lt;br&gt;+isCheckInOpen(now): bool')
grow('c34', L); grow('c31', L)
# AuditLog: before/after and where
sub('-logId: int&lt;br&gt;-action: string&lt;br&gt;-timestamp: datetime', '-logId: int&lt;br&gt;-action: string&lt;br&gt;-entity: string&lt;br&gt;-before / after: json&lt;br&gt;-ip: string&lt;br&gt;-timestamp: datetime')
grow('c24', 3 * L); grow('c23', 3 * L); shift('c25', 3 * L); shift('c26', 3 * L)
sub('<mxGeometry height="168" width="200" x="-450" y="-1280"', '<mxGeometry height="168" width="200" x="-450" y="-1330"')
# New class: CheckInService, right of BookingService, with dependencies on Booking and Event
CLS = 'swimlane;fontStyle=1;align=center;startSize=26;html=1;collapsible=0;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;swimlaneFillColor=#ffffff;'
TXT = 'text;html=1;align=left;verticalAlign=top;spacingLeft=6;whiteSpace=wrap;'
new = f'''<mxCell id="k1" parent="1" style="{CLS}" value="CheckInService" vertex="1"><mxGeometry height="132" width="270" x="530" y="-830" as="geometry" /></mxCell>
<mxCell id="k2" parent="k1" style="{TXT}" value="-windowHours: int = 3" vertex="1"><mxGeometry height="26" width="270" y="26" as="geometry" /></mxCell>
<mxCell id="k3" parent="k1" style="line;strokeWidth=1;html=1;" value="" vertex="1"><mxGeometry height="2" width="270" y="52" as="geometry" /></mxCell>
<mxCell id="k4" parent="k1" style="{TXT}" value="+checkIn(reference, event): Booking&lt;br&gt;+undo(booking)&lt;br&gt;+normaliseRef(text): string&lt;br&gt;+openEvents(): Event[]" vertex="1"><mxGeometry height="80" width="270" y="54" as="geometry" /></mxCell>
<mxCell id="k5" edge="1" parent="1" source="k1" style="endArrow=open;dashed=1;html=1;" target="c19" value=""><mxGeometry relative="1" as="geometry" /></mxCell>
<mxCell id="k6" edge="1" parent="1" source="k1" style="endArrow=open;dashed=1;html=1;" target="c31" value=""><mxGeometry relative="1" as="geometry" /></mxCell>
'''
sub('</root>', new + '</root>')
open(p, 'w', encoding='utf-8').write(s)
print('regenerated ER, use case; patched class diagram')
