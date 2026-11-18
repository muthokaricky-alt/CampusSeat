"""Generates docs/diagrams/source/CampusSeat_FlowChart.drawio: booking, then door check-in."""
import os
from xml.sax.saxutils import escape
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'source')
q = lambda v: escape(v, {'"': '&quot;'})
BOX = 'rounded=1;whiteSpace=wrap;html=1;fontSize=12;arcSize=20;fillColor={f};strokeColor=#333333;'
DEC = 'rhombus;whiteSpace=wrap;html=1;fontSize=12;fillColor=#ffffff;strokeColor=#333333;'
END = 'ellipse;whiteSpace=wrap;html=1;fontSize=13;fillColor=#e6edf7;strokeColor=#333333;'
EDGE = 'html=1;rounded=0;endArrow=block;endFill=1;fontSize=11;labelBackgroundColor=default;'
WHITE, OK, BAD, TX = '#ffffff', '#e8f3e4', '#f8e3e3', '#e8f3e4'
cells = []
def node(i, label, x, y, w, h, style):
    cells.append(f'<mxCell id="{i}" value="{q(label)}" style="{style}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
def box(i, label, y, h=60, fill=WHITE, x=180, w=240): node(i, label, x, y, w, h, BOX.format(f=fill))
def dec(i, label, y, h=96): node(i, label, 190, y, 220, h, DEC)
def err(i, label, y, h=64): node(i, label, 520, y, 210, h, BOX.format(f=BAD))
def edge(i, a, b, label='', extra='', points=(), dashed=False):
    st = EDGE + extra + ('dashed=1;' if dashed else '')
    pts = ''.join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in points)
    geo = f'<mxGeometry relative="1" as="geometry"><Array as="points">{pts}</Array></mxGeometry>' if points else '<mxGeometry relative="1" as="geometry"/>'
    cells.append(f'<mxCell id="{i}" value="{q(label)}" style="{st}" edge="1" parent="1" source="{a}" target="{b}">{geo}</mxCell>')

node('start', 'Start', 250, 20, 100, 44, END)
box('login', 'Log in with email and password (then a 6-digit code if two-factor is on)', 100, 64)
dec('d1', 'Details correct?', 204)
err('e1', 'One general error message; 5 failures lock the account for a while', 220)
box('browse', 'Browse events: search, filter by type, This week, Saved', 340)
box('select', 'Open an event and select Reserve my seat (details come from the account)', 440, 64)
box('tx', 'Begin transaction: lock the event row', 544, 50, TX)
dec('d2', 'Event already ended?', 630)
err('e2', 'Roll back: "this event has already taken place"', 646)
dec('d3', 'Already booked it?', 760)
err('e3', 'Roll back: "you have already booked a seat for this event"', 776)
dec('d4', 'Open to your school?', 890)
err('e4', 'Roll back: "this event is open to ... only"', 906)
dec('d5', 'Seat left?', 1020)
err('e5', 'Roll back: "this event is full", offer Join the waitlist', 1036)
box('save', 'Save the booking with a unique reference and commit; audit BOOK_SEAT', 1150, 64, OK)
box('card', 'Show the registration card with its QR code (kept on the phone for offline use)', 1250, 64)
box('door', 'At the door: staff scan the QR code or type the reference', 1350, 60)
dec('d6', 'Right event, check-in open, card not used yet?', 1446, 110)
err('e6', 'Amber or red result with the reason; nothing is recorded', 1468)
box('in', 'Checked in: green result; audit CHECK_IN', 1600, 56, OK)
node('end', 'End', 250, 1696, 100, 44, END)

chain = ['start', 'login', 'd1', 'browse', 'select', 'tx', 'd2', 'd3', 'd4', 'd5', 'save', 'card', 'door', 'd6', 'in', 'end']
labels = {('d1', 'browse'): 'yes', ('d2', 'd3'): 'no', ('d3', 'd4'): 'no', ('d4', 'd5'): 'yes', ('d5', 'save'): 'yes', ('d6', 'in'): 'yes'}
for n, (a, b) in enumerate(zip(chain, chain[1:])):
    edge(f'm{n}', a, b, labels.get((a, b), ''), 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;')
side = 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;'
for d, e, lab in [('d1', 'e1', 'no'), ('d2', 'e2', 'yes'), ('d3', 'e3', 'yes'), ('d4', 'e4', 'no'), ('d5', 'e5', 'no'), ('d6', 'e6', 'no')]:
    edge(f's{d}', d, e, lab, side)
# Back to where the person continues: errors at login go back to login; booking errors back to browsing; door errors to the next card.
edge('b1', 'e1', 'login', '', 'exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;', points=((625, 132),), dashed=True)
for e, y in [('e2', 678), ('e3', 808), ('e4', 938), ('e5', 1068)]:
    edge(f'b{e}', e, 'browse', '', 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;', points=((790, y), (790, 370)), dashed=True)
edge('be6', 'e6', 'door', 'next card', 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;', points=((770, 1500), (770, 1380)), dashed=True)

xml = ('<mxfile host="app.diagrams.net"><diagram name="Booking and check-in flow" id="campusseat-flow"><mxGraphModel dx="1000" dy="1800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1800" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
       + ''.join(cells) + '</root></mxGraphModel></diagram></mxfile>\n')
open(os.path.join(SRC, 'CampusSeat_FlowChart.drawio'), 'w', encoding='utf-8').write(xml)
print('flow chart written')
