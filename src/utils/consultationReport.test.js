import test from 'node:test';
import assert from 'node:assert/strict';
import { consultationSelection, changeConsultationStudent, consultationReportReturn } from './consultationReport.js';
const nurse = { role: 'school_nurse' };
const data = { students: [{ id: 'a', patientType: 'student' }, { id: 'b', patientType: 'student' }, { id: 'f', patientType: 'faculty' }], visits: [{ id: 'old', studentId: 'a', date: '2026-01-01' }, { id: 'recent', patientId: 'a', date: '2026-02-01' }, { id: 'foreign', studentId: 'unlinked', date: '2026-03-01' }] };
const params = (value) => new URLSearchParams(value);
test('student change clears the previous visit and empty students cannot inherit its print selection', () => {
 const before = params('tab=consultation&patientId=a&visitId=recent&period=monthly');
 assert.equal(consultationSelection(data, nurse, before).selected.visit.id, 'recent');
 const changed = changeConsultationStudent(before, 'b');
 assert.equal(changed.has('visitId'), false);
 assert.equal(changed.get('period'), 'monthly');
 assert.equal(before.get('visitId'), 'recent');
 const state = consultationSelection(data, nurse, changed);
 assert.equal(state.student.id, 'b'); assert.deepEqual(state.visits, []); assert.equal(state.selected, null);
 const cleared = changeConsultationStudent(changed, '');
 assert.equal(cleared.has('patientId'), false); assert.equal(consultationSelection(data,nurse,cleared).student,null);
});
test('stale, mismatched and faculty URLs do not expose a printable consultation', () => {
 for (const query of ['patientId=a&visitId=foreign','patientId=b&visitId=recent','patientId=missing&visitId=old','patientId=f&visitId=old','patientId=a&visitId=deleted','patientId=a']) assert.equal(consultationSelection(data,nurse,params(query)).selected,null);
 const state = consultationSelection(data,nurse,params('patientId=a&visitId=recent'));
 assert.deepEqual(state.students.map(x=>x.id),['a','b']); assert.deepEqual(state.visits.map(x=>x.id),['recent','old']);
 assert.equal(consultationSelection({...data,visits:[]},nurse,params('patientId=a&visitId=recent')).selected,null);
});
test('non-nurses receive neither choices nor a selection even with a valid deep link', () => {
 for(const user of [null,{}, {role:'guardian'}, {role:'system_administrator'}]) assert.deepEqual(consultationSelection(data,user,params('patientId=a&visitId=recent')),{students:[],student:null,visits:[],selected:null});
});
test('Back and Cancel target preserves selected visit and safely encodes IDs as fixed local report query', () => {
 const target=consultationReportReturn('a','recent');
 const url=new URL(target,'https://healthmateplus.com');
 assert.equal(url.pathname,'/reports'); assert.equal(url.searchParams.get('tab'),'consultation');
 assert.equal(consultationSelection(data,nurse,url.searchParams).selected.visit.id,'recent');
 const tricky=new URL(consultationReportReturn('x&tab=clinic','https://evil.invalid/#x'),'https://healthmateplus.com');
 assert.equal(tricky.origin,'https://healthmateplus.com');assert.equal(tricky.searchParams.get('tab'),'consultation');assert.equal(tricky.searchParams.get('patientId'),'x&tab=clinic');
 assert.equal(consultationReportReturn(),'/reports?tab=consultation');
});
