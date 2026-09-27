export const DEMO_DATASET_KEY = 'healthmate-plus-demo-v1';

const FIRST_NAMES = [
  'Aira', 'Althea', 'Amihan', 'Andrea', 'Angelo', 'Apolinario', 'Beatriz', 'Bianca', 'Carlo', 'Carmela',
  'Catalina', 'Clarisse', 'Dahlia', 'Danica', 'Diego', 'Emilio', 'Enzo', 'Erika', 'Estrella', 'Felipe',
  'Gabriel', 'Hana', 'Iñigo', 'Isabel', 'Joaquin', 'Josefina', 'Julian', 'Kai', 'Lara', 'Leandro',
  'Lourdes', 'Luna', 'Mara', 'Marco', 'Mateo', 'Mikaela', 'Nico', 'Noemi', 'Rafael', 'Samantha',
  'Teresa', 'Tristan', 'Valentina', 'Xavier', 'Yasmin', 'Zia',
];

const SURNAMES = [
  'Agbayani', 'Alcantara', 'Aquino', 'Bautista', 'Caballero', 'Cabrera', 'Castillo', 'Dela Cruz', 'De Guzman', 'Del Rosario',
  'Domingo', 'Enriquez', 'Estrada', 'Fernandez', 'Francisco', 'Garcia', 'Hernandez', 'Jimenez', 'Lacson', 'Laurel',
  'Legaspi', 'Lim', 'Lopez', 'Manalo', 'Marquez', 'Mendoza', 'Mercado', 'Navarro', 'Ocampo', 'Pascual',
  'Reyes', 'Rivera', 'Salazar', 'Santos', 'Soriano', 'Tan', 'Tolentino', 'Valdez', 'Velasco', 'Villanueva',
];

const SECTIONS = ['Rizal', 'Mabini', 'Bonifacio', 'Luna', 'Del Pilar'];
const ADVISERS = ['A. Mendoza', 'C. Flores', 'J. Reyes', 'L. Garcia', 'M. Lim', 'R. Navarro', 'S. Bautista', 'T. Villanueva'];
const DEPARTMENTS = ['Arts and Humanities', 'Languages', 'Mathematics', 'Science', 'Student Services', 'Physical Education', 'Library'];
const BLOOD_TYPES = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-'];

const VISIT_SCENARIOS = [
  { type: 'Illness', chiefComplaint: 'Headache', treatment: 'Quiet rest and water offered', disposition: 'Returned to class' },
  { type: 'Illness', chiefComplaint: 'Stomach discomfort', treatment: 'Rest and observation; guardian notified when symptoms persisted', disposition: 'Returned to class' },
  { type: 'Illness', chiefComplaint: 'Cough', treatment: 'Rest, water offered, and guardian updated', disposition: 'Returned to class', followUp: true },
  { type: 'Illness', chiefComplaint: 'Nasal congestion', treatment: 'Brief rest and return-to-class check', disposition: 'Returned to class' },
  { type: 'Illness', chiefComplaint: 'Sore throat', treatment: 'Comfort check and guardian notification', disposition: 'Returned to class', followUp: true },
  { type: 'Illness', chiefComplaint: 'Dizziness after activity', treatment: 'Seated rest and water offered; activity paused', disposition: 'Returned to class' },
  { type: 'Illness', chiefComplaint: 'Menstrual cramps', treatment: 'Rest in a quiet area and guardian contacted', disposition: 'Returned to class', followUp: true },
  { type: 'Illness', chiefComplaint: 'Itchy eyes', treatment: 'Face rinsed with clean water and guardian updated', disposition: 'Returned to class' },
  { type: 'Illness', chiefComplaint: 'Minor skin irritation', treatment: 'Area rinsed and observed; guardian notified', disposition: 'Returned to class' },
  { type: 'Injury', chiefComplaint: 'Small scrape', treatment: 'Area cleaned and covered with a dressing', disposition: 'Returned to class' },
  { type: 'Injury', chiefComplaint: 'Minor finger bump', treatment: 'Cold pack offered and comfort checked', disposition: 'Returned to class' },
  { type: 'Injury', chiefComplaint: 'Ankle discomfort after play', treatment: 'Activity paused; cold pack offered and guardian contacted', disposition: 'Returned to class', followUp: true },
  { type: 'Injury', chiefComplaint: 'Small paper cut', treatment: 'Area rinsed and covered with a dressing', disposition: 'Returned to class' },
  { type: 'Follow-up', chiefComplaint: 'Return check after earlier visit', treatment: 'Symptoms and return-to-class plan reviewed', disposition: 'Returned to class' },
  { type: 'Follow-up', chiefComplaint: 'Follow-up for comfort plan', treatment: 'Student checked in with clinic staff', disposition: 'Returned to class' },
  { type: 'Routine Check', chiefComplaint: 'Scheduled clinic check-in', treatment: 'Routine record review and student questions addressed', disposition: 'Returned to class' },
  { type: 'Emergency', chiefComplaint: 'Unexpected discomfort during class', treatment: 'Nurse assessment completed and guardian contacted promptly', disposition: 'Referred to physician', followUp: true },
];

const INVENTORY_CATALOG = [
  ['Paracetamol 500 mg tablets', 'Analgesics', 'medication', 'tablets', 360, 60],
  ['Paracetamol suspension', 'Analgesics', 'medication', 'bottles', 32, 8],
  ['Cetirizine 10 mg tablets', 'Respiratory', 'medication', 'tablets', 120, 30],
  ['Salbutamol inhaler', 'Respiratory', 'medication', 'inhalers', 18, 6],
  ['Oral rehydration salts', 'Supplies', 'medication', 'sachets', 140, 30],
  ['Antacid chewable tablets', 'Analgesics', 'medication', 'tablets', 120, 30],
  ['Antiseptic solution', 'First Aid', 'medication', 'bottles', 24, 6],
  ['Adhesive bandages', 'First Aid', 'supply', 'pieces', 480, 80],
  ['Sterile gauze pads', 'First Aid', 'supply', 'packs', 90, 20],
  ['Elastic bandage rolls', 'First Aid', 'supply', 'pieces', 48, 12],
  ['Instant cold packs', 'First Aid', 'supply', 'pieces', 42, 10],
  ['Disposable gloves, small', 'Supplies', 'supply', 'boxes', 18, 5],
  ['Disposable gloves, medium', 'Supplies', 'supply', 'boxes', 22, 5],
  ['Disposable gloves, large', 'Supplies', 'supply', 'boxes', 14, 4],
  ['Surgical masks', 'Supplies', 'supply', 'pieces', 300, 60],
  ['Cotton balls', 'Supplies', 'supply', 'packs', 36, 8],
  ['Cotton swabs', 'Supplies', 'supply', 'boxes', 28, 6],
  ['Medical tape', 'First Aid', 'supply', 'pieces', 54, 12],
  ['Saline wash', 'First Aid', 'supply', 'bottles', 32, 8],
  ['Digital thermometer covers', 'Supplies', 'supply', 'boxes', 15, 4],
  ['Digital thermometers', 'Supplies', 'supply', 'pieces', 12, 3],
  ['Pulse oximeter', 'Supplies', 'supply', 'pieces', 4, 1],
  ['Hand sanitizer', 'Supplies', 'supply', 'bottles', 48, 10],
  ['Liquid hand soap', 'Supplies', 'supply', 'bottles', 32, 8],
  ['Paper towels', 'Supplies', 'supply', 'packs', 40, 10],
  ['Disposable emesis bags', 'Supplies', 'supply', 'pieces', 90, 20],
  ['Triangular bandages', 'First Aid', 'supply', 'pieces', 16, 4],
  ['Safety pins', 'First Aid', 'supply', 'boxes', 10, 3],
  ['Eye wash solution', 'First Aid', 'supply', 'bottles', 12, 3],
  ['Instant glucose tablets', 'Emergency', 'medication', 'bottles', 14, 3],
  ['Reusable ice bags', 'First Aid', 'supply', 'pieces', 16, 4],
  ['Digital scale batteries', 'Supplies', 'supply', 'packs', 12, 3],
  ['Disposable tongue depressors', 'Supplies', 'supply', 'boxes', 18, 4],
  ['First-aid scissors', 'First Aid', 'supply', 'pieces', 8, 2],
];

const pad = (value, size = 4) => String(value).padStart(size, '0');

function clinicToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function integer(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function dateAtOffset(referenceDate, offset) {
  const date = new Date(`${referenceDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function weekday(date) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function weekdayDate(referenceDate, offset, direction) {
  let date = dateAtOffset(referenceDate, offset);
  while (weekday(date) === 0 || weekday(date) === 6) date = dateAtOffset(date, direction);
  return date;
}

function birthDateForAge(referenceDate, age, random) {
  const reference = new Date(`${referenceDate}T12:00:00.000Z`);
  const year = reference.getUTCFullYear() - age;
  const month = integer(random, 0, 11);
  const day = integer(random, 1, 27);
  return new Date(Date.UTC(year, month, day, 12)).toISOString().slice(0, 10);
}

function formatTime(hour, minute) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${String(displayHour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function timeValue(random, startHour = 7, endHour = 15) {
  const totalMinutes = integer(random, startHour * 60 + 15, endHour * 60 + 30);
  const hour = Math.floor(totalMinutes / 60);
  const minute = Math.floor((totalMinutes % 60) / 5) * 5;
  return formatTime(hour, minute);
}

function makePatients(referenceDate, random) {
  const students = [];
  for (let index = 1; index <= 190; index += 1) {
    const gradeNumber = 1 + ((index - 1) % 12);
    const age = Math.max(6, Math.min(18, gradeNumber + 5 + integer(random, -1, 1)));
    const surname = pick(random, SURNAMES).trim();
    const patient = {
      id: `demo-patient-${pad(index)}`,
      studentId: `DEMO-STU-${pad(index)}`,
      patientType: 'student',
      name: `${pick(random, FIRST_NAMES)} ${surname}`,
      gradeLevel: `Grade ${gradeNumber}`,
      section: pick(random, SECTIONS),
      adviser: pick(random, ADVISERS),
      birthDate: birthDateForAge(referenceDate, age, random),
      gender: pick(random, ['Female', 'Male']),
      guardianName: `${pick(random, FIRST_NAMES)} ${surname}`,
      guardianPhone: 'DEMO-NO-CONTACT',
      guardianRelation: pick(random, ['Mother', 'Father', 'Guardian', 'Grandparent']),
      bloodType: pick(random, BLOOD_TYPES),
      allergies: pick(random, ['', '', '', '', 'Peanuts (recorded)', 'Dust (recorded)', 'Ibuprofen (recorded)', 'Pollen (recorded)']),
      conditions: pick(random, ['', '', '', 'Mild asthma (recorded)', 'Allergic rhinitis (recorded)', 'Migraine history (recorded)']),
      medications: pick(random, ['', '', '', 'Rescue inhaler listed', 'Antihistamine listed', 'No medication listed']),
      demoDataset: DEMO_DATASET_KEY,
      demoNotice: 'Fictional demonstration record. No real person or contact details.',
    };
    students.push(patient);
  }

  const faculty = [];
  for (let index = 1; index <= 20; index += 1) {
    const surname = pick(random, SURNAMES).trim();
    faculty.push({
      id: `demo-faculty-${pad(index)}`,
      facultyId: `DEMO-FAC-${pad(index)}`,
      patientType: 'faculty',
      name: `${pick(random, FIRST_NAMES)} ${surname}`,
      gradeLevel: 'Faculty',
      section: '',
      adviser: '',
      department: pick(random, DEPARTMENTS),
      position: pick(random, ['Teacher', 'Guidance staff', 'Library staff', 'Coach', 'Administrative staff']),
      email: `faculty${pad(index)}@example.test`,
      contactNumber: 'DEMO-NO-CONTACT',
      birthDate: birthDateForAge(referenceDate, integer(random, 24, 63), random),
      gender: pick(random, ['Female', 'Male']),
      guardianName: '',
      guardianPhone: 'DEMO-NO-CONTACT',
      guardianRelation: '',
      bloodType: pick(random, BLOOD_TYPES),
      allergies: pick(random, ['', '', 'Latex (recorded)', 'Pollen (recorded)']),
      conditions: pick(random, ['', '', 'Mild asthma (recorded)', 'Migraine history (recorded)']),
      medications: pick(random, ['', '', 'Medication listed in fictional record']),
      demoDataset: DEMO_DATASET_KEY,
      demoNotice: 'Fictional demonstration record. No real person or contact details.',
    });
  }
  return [...students, ...faculty];
}

function makeVisits(patients, referenceDate, random) {
  const visits = [];
  for (let index = 1; index <= 480; index += 1) {
    const offset = -integer(random, 0, 210);
    const patient = pick(random, patients);
    const scenario = pick(random, VISIT_SCENARIOS);
    const date = weekdayDate(referenceDate, offset, -1);
    const time = timeValue(random);
    const followUp = Boolean(scenario.followUp && random() < 0.65 && date < referenceDate);
    const followUpDate = followUp ? dateAtOffset(date, integer(random, 2, 14)) : null;
    const visit = {
      id: `demo-visit-${pad(index)}`,
      studentId: patient.id,
      date,
      time,
      type: scenario.type,
      chiefComplaint: scenario.chiefComplaint,
      treatment: scenario.treatment,
      disposition: scenario.disposition,
      followUp,
      ...(followUp ? { followUpDate } : {}),
      nurseName: 'Nurse Elena Lim',
      painScore: scenario.type === 'Injury' ? integer(random, 1, 4) : null,
      temperature: scenario.chiefComplaint === 'Cough' || scenario.chiefComplaint === 'Sore throat'
        ? Number((36.5 + random() * 1.2).toFixed(1))
        : null,
      pulse: scenario.type === 'Emergency' ? integer(random, 76, 108) : null,
      notes: 'Fictional sample entry for workflow demonstration; details are not clinical advice.',
      demoDataset: DEMO_DATASET_KEY,
    };
    visits.push(visit);
  }
  return visits.sort((first, second) => first.date.localeCompare(second.date) || first.time.localeCompare(second.time) || first.id.localeCompare(second.id));
}

function makeAppointments(patients, referenceDate, random) {
  const appointments = [];
  const usedStarts = new Set();
  for (let index = 1; index <= 42; index += 1) {
    const status = index <= 12 ? 'Completed' : index <= 18 ? 'Cancelled' : index <= 30 ? 'Scheduled' : 'Requested';
    const future = status === 'Scheduled' || status === 'Requested';
    let dayDistance = future ? index - 18 : index;
    let date = weekdayDate(referenceDate, future ? dayDistance : -dayDistance, future ? 1 : -1);
    const timeIndex = (index * 3) % 16;
    const hour = 8 + Math.floor(timeIndex / 2);
    const minute = timeIndex % 2 ? 30 : 0;
    const time = formatTime(hour, minute);
    let startsAt = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
    while (usedStarts.has(startsAt)) {
      dayDistance += 1;
      date = weekdayDate(referenceDate, future ? dayDistance : -dayDistance, future ? 1 : -1);
      startsAt = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
    }
    usedStarts.add(startsAt);
    const patient = pick(random, patients);
    appointments.push({
      id: `demo-appointment-${pad(index)}`,
      studentId: patient.id,
      date,
      time,
      startsAt,
      reason: pick(random, ['Return check after earlier visit', 'Clinic care plan review', 'Follow-up check-in', 'Health concern discussion', 'Scheduled student check-in']),
      status,
      note: 'Fictional appointment for workflow demonstration; no notification will be sent.',
      demoDataset: DEMO_DATASET_KEY,
    });
  }
  return appointments;
}

function makeInventory(referenceDate) {
  return INVENTORY_CATALOG.map(([name, category, itemType, unit, startingQuantity, reorderLevel], index) => {
    const itemId = `demo-inventory-${pad(index + 1)}`;
    const expiryDate = dateAtOffset(referenceDate, 450 + (index % 6) * 120);
    return {
      id: itemId,
      name,
      category,
      itemType,
      unit,
      startingQuantity,
      quantity: startingQuantity,
      expiryDate,
      reorderLevel,
      demoDataset: DEMO_DATASET_KEY,
    };
  });
}

function makeDispenseLogs(visits, inventory) {
  const stockById = new Map(inventory.map((item) => [item.id, item]));
  const logs = [];
  visits.forEach((visit, index) => {
    if ((index + 1) % 4 !== 0) return;
    const complaint = visit.chiefComplaint;
    const itemId = complaint.includes('scrape') || complaint.includes('paper cut')
      ? 'demo-inventory-0008'
      : complaint.includes('bump') || complaint.includes('Ankle')
        ? 'demo-inventory-0011'
        : complaint.includes('eye')
          ? 'demo-inventory-0019'
          : complaint.includes('Headache') || complaint.includes('cramps')
            ? 'demo-inventory-0001'
            : complaint.includes('Cough') || complaint.includes('throat') || complaint.includes('congestion')
              ? 'demo-inventory-0015'
              : ['demo-inventory-0007', 'demo-inventory-0009', 'demo-inventory-0018'][logs.length % 3];
    const item = stockById.get(itemId);
    const quantity = 1;
    item.quantity -= quantity;
    logs.push({
      id: `demo-dispense-${pad(logs.length + 1)}`,
      visitId: visit.id,
      studentId: visit.studentId,
      medicineId: item.id,
      itemName: item.name,
      itemType: item.itemType,
      quantity,
      date: visit.date,
      time: visit.time,
      nurseName: visit.nurseName,
      note: 'Fictional demonstration stock entry; no actual item was dispensed.',
      demoDataset: DEMO_DATASET_KEY,
    });
  });
  return logs;
}

/** Build repeatable fictional clinic data. Pass a YYYY-MM-DD reference date to freeze its date range. */
export function generateDemoData({ asOf = clinicToday(), seed = 0x484D4154 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || new Date(`${asOf}T00:00:00.000Z`).toISOString().slice(0, 10) !== asOf) {
    throw new TypeError('Demo data reference date must be a valid YYYY-MM-DD date.');
  }
  const random = createRandom(seed);
  const students = makePatients(asOf, random);
  const visits = makeVisits(students, asOf, random);
  const appointments = makeAppointments(students, asOf, random);
  const inventory = makeInventory(asOf);
  const dispenseLogs = makeDispenseLogs(visits, inventory);

  return {
    schemaVersion: 1,
    settings: {
      schoolName: 'DEMO — Fictional Tong Ho Academy',
      clinicName: 'Demonstration School Health Center',
      schoolYear: `${new Date(`${asOf}T00:00:00.000Z`).getUTCFullYear()}–${new Date(`${asOf}T00:00:00.000Z`).getUTCFullYear() + 1}`,
      nurseName: 'Nurse Elena Lim',
      address: 'Fictional campus address — Quezon City, Philippines',
      contactNumber: 'DEMO-NO-CONTACT',
      demoNotice: 'All people, visits, appointments, and stock records in this dataset are fictional.',
    },
    students,
    visits,
    appointments,
    inventory,
    dispenseLogs,
    stockAdjustments: [],
  };
}
