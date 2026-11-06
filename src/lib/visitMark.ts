import type {VisitMark} from '../models';
type Mark = Exclude<VisitMark, ''>;
export const markLabel: Record<Mark, string> = {初: '初診', 往: '往診', 注: '注射予定'};
export const markClass: Record<Mark, string> = {初: 'first', 往: 'house', 注: 'injection'};
