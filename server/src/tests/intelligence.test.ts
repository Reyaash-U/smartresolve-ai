import { describe, expect, it } from 'vitest';
import { NaiveBayes } from '../ml/naiveBayes';
import { MODEL_VERSION, classifyIssue, getModel, testSet, trainSet } from '../ml/classifier';
import { evaluate, maxLeakage } from '../ml/evaluate';
import { findDuplicates, type DupDoc } from '../services/duplicates';
import { pickStaff } from '../services/routing';

const cls = (title: string, description: string) => classifyIssue(title, description);

describe('dataset and evaluation', () => {
  it('meets the dataset size rules', () => {
    for (const label of ['IT Support', 'Facilities', 'Administration']) {
      expect(trainSet.filter((s) => s.label === label).length).toBeGreaterThanOrEqual(20);
      expect(testSet.filter((s) => s.label === label).length).toBeGreaterThanOrEqual(10);
    }
    expect(trainSet.length + testSet.length).toBeGreaterThanOrEqual(90);
    expect(testSet.length).toBeGreaterThanOrEqual(30);
  });
  it('has no near-duplicate leakage between train and test', () => {
    expect(maxLeakage(trainSet, testSet).max).toBeLessThan(0.6);
  });
  it('beats chance by a wide margin on unseen held-out data', () => {
    const ev = evaluate(getModel(), testSet);
    expect(ev.accuracy).toBeGreaterThan(0.8);
    expect(ev.labels).toHaveLength(3);
  });
  it('is deterministic', () => {
    const a = new NaiveBayes().train(trainSet).predict('Wi-Fi is down');
    const b = new NaiveBayes().train(trainSet).predict('Wi-Fi is down');
    expect(a).toEqual(b);
    expect(MODEL_VERSION).toMatch(/^nb-r1-/);
  });
});

describe('classification decisions', () => {
  it('routes a clear IT issue', () => {
    const r = cls('Lab 204 Wi-Fi is down', 'The Wi-Fi in computer lab 204 has been down since morning and nobody can connect.');
    expect(r).toMatchObject({ department: 'IT Support', needsReview: false });
    expect(r.topTerms.length).toBeGreaterThan(0);
  });
  it('routes a clear Facilities issue', () => {
    expect(cls('Leaking tap', 'Water is leaking from the tap in the washroom and the floor is wet.')).toMatchObject({ department: 'Facilities', needsReview: false });
  });
  it('routes a clear Administration issue', () => {
    expect(cls('ID card', 'I need a replacement student ID card certificate from the office.')).toMatchObject({ department: 'Administration', needsReview: false });
  });
  it('sends an ambiguous report to review instead of guessing (Journey C)', () => {
    const r = cls('Nothing is working', 'Nothing is working in the main office.');
    expect(r.needsReview).toBe(true);
    expect(r.department).toBeNull();
    expect(r.reason).not.toBe('');
  });
  it('sends gibberish with no known words to review', () => {
    expect(cls('Zxqv plmk', 'Qwerty asdfgh zxcvbn uiop hjkl').needsReview).toBe(true);
  });
});

describe('duplicate detection', () => {
  const doc = (id: string, title: string, description: string, room: string, department: string | null, building = 'Computer Labs'): DupDoc => ({ id, title, description, building, room, department });
  const wifiA = doc('A', 'Lab 204 Wi-Fi is down', 'The Wi-Fi in computer lab 204 is down and nobody can connect.', 'Lab 204', 'IT Support');
  const wifiB = doc('B', 'No internet in computer lab 204', 'There is no internet in the computer lab 204 for all students.', 'Lab 204', 'IT Support');

  it('suggests the Journey B Wi-Fi pair with reasons', () => {
    const out = findDuplicates(wifiB, [wifiA]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('A');
    expect(out[0].reasons.join(' ')).toMatch(/Same room/);
  });
  it('does not suggest an unrelated Facilities complaint', () => {
    const tap = doc('C', 'Leaking tap in washroom', 'Water is dripping from the washroom tap on the ground floor.', 'Washroom', 'Facilities', 'Main Block');
    expect(findDuplicates(wifiB, [tap])).toHaveLength(0);
    expect(findDuplicates(tap, [wifiA, wifiB])).toHaveLength(0);
  });
  it('does not match a different problem in the same room', () => {
    const proj = doc('D', 'Projector shows no image', 'The projector in lab 204 shows no picture at all from the laptop.', 'Lab 204', 'IT Support');
    expect(findDuplicates(wifiB, [proj])).toHaveLength(0);
  });
  it('skips candidates in a different known department', () => {
    const other = { ...wifiA, id: 'E', department: 'Facilities' };
    expect(findDuplicates(wifiB, [other])).toHaveLength(0);
  });
  it('returns at most three, best first, and never the issue itself', () => {
    const many = ['1', '2', '3', '4', '5'].map((i) => ({ ...wifiA, id: i }));
    const out = findDuplicates(wifiB, [...many, wifiB]);
    expect(out).toHaveLength(3);
    expect(out.find((o) => o.id === 'B')).toBeUndefined();
  });
});

describe('staff selection', () => {
  it('picks the lowest workload', () => expect(pickStaff([{ staffId: 'b', active: 3 }, { staffId: 'a', active: 1 }])).toBe('a'));
  it('breaks ties deterministically by staff ID', () => {
    expect(pickStaff([{ staffId: 'c', active: 2 }, { staffId: 'a', active: 2 }, { staffId: 'b', active: 2 }])).toBe('a');
  });
  it('returns null when nobody is eligible', () => expect(pickStaff([])).toBeNull());
});
