// using literal strings instead of numbers so that it's easier to inspect
// 使用文字字符串而不是数字，以便更容易检查
// debugger events

export const enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate'
}

export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}
