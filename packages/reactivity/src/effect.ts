import { TrackOpTypes, TriggerOpTypes } from './operations'
import { extend, isArray, isIntegerKey, isMap } from '@vue/shared'
import { EffectScope, recordEffectScope } from './effectScope'
import {
  createDep,
  Dep,
  finalizeDepMarkers,
  initDepMarkers,
  newTracked,
  wasTracked
} from './dep'
import { ComputedRefImpl } from './computed'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

// The number of effects currently being tracked recursively.
let effectTrackDepth = 0

export let trackOpBit = 1

/**
 * The bitwise track markers support at most 30 levels of recursion.
 * This value is chosen to enable modern JS engines to use a SMI on all platforms.
 * When recursion depth is greater, fall back to using a full cleanup.
 */
const maxMarkerBits = 30

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: ReactiveEffect
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined

  /**
   * Can be attached after creation
   * @internal
   */
  computed?: ComputedRefImpl<T>
  /**
   * @internal
   */
  allowRecurse?: boolean

  onStop?: () => void
  // dev only
  onTrack?: (event: DebuggerEvent) => void
  // dev only
  onTrigger?: (event: DebuggerEvent) => void

  constructor(
    public fn: () => T,
    public scheduler: EffectScheduler | null = null,
    scope?: EffectScope
  ) {
    recordEffectScope(this, scope)
    console.log('new ReactiveEffect')
  }

  run() {
    console.log('run')
    // active为false，返回fn
    if (!this.active) {
      return this.fn()
    }
    // 获取父亲
    let parent: ReactiveEffect | undefined = activeEffect
    // 是否需要收集
    let lastShouldTrack = shouldTrack
    // 找到自己的最大的父亲
    while (parent) {
      if (parent === this) {
        return
      }
      parent = parent.parent
    }
    try {
      this.parent = activeEffect
      activeEffect = this
      shouldTrack = true

      trackOpBit = 1 << ++effectTrackDepth

      if (effectTrackDepth <= maxMarkerBits) {
        initDepMarkers(this)
      } else {
        cleanupEffect(this)
      }
      return this.fn()
    } finally {
      if (effectTrackDepth <= maxMarkerBits) {
        finalizeDepMarkers(this)
      }

      trackOpBit = 1 << --effectTrackDepth

      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined
    }
  }

  stop() {
    // 判断状态，不能一直清空
    if (this.active) {
      // 遍历deps里面的dep，去delete自己
      cleanupEffect(this)
      // 如果有Onstop，回调
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}

function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  lazy?: boolean
  scheduler?: EffectScheduler
  scope?: EffectScope
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

// 
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  if ((fn as ReactiveEffectRunner).effect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }
  // new一个 ReactiveEffect
  const _effect = new ReactiveEffect(fn)
  if (options) {
    // 把options的属性给_effect
    extend(_effect, options)
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  if (!options || !options.lazy) {
    // 调用run的时候执行内部的fn
    _effect.run()
  }
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  // 存储effect，为了拿到属性
  runner.effect = _effect
  // 返回runner是为了run方法的返回值
  return runner
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 依赖收集 
// targetMap ： { obj对象作为key: depsMap } WeakMap优点:垃圾回收机制友好 
// obj就是target，就是将target的属性，举例 title与当前组件的更新函数建立联系 activeEffect就是setupRenderEffect中的effect
//                             targetMap: {obj: { key: [ activeEffect ] }} 保存依赖关系
                              // WeakMap Map Set function
export function track(target: object, type: TrackOpTypes, key: unknown) {

  if (shouldTrack && activeEffect) {
    // 第一次来的时候，需要初始化创建以obj对象作为key对应的value值的对象
    console.log('track', target)
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      // new Map
      targetMap.set(target, (depsMap = new Map()))
    }
    // 第一次来的时候，需要初始化作为以obj对象为key对应的value值的对象里的key
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }

    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined
    // 创建依赖关系
    trackEffects(dep, eventInfo)
  }
}

export function trackEffects(
  dep: Dep,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  console.log('trackEffects', dep)
  // 将shouldTrack置为false
  let shouldTrack = false
  // let effectTrackDepth = 0 应该是没改变的
  if (effectTrackDepth <= maxMarkerBits) {
    // 如果不是新的dep
    if (!newTracked(dep)) {
      dep.n |= trackOpBit // set newly tracked 重新追踪
      // 是否收集依赖
      shouldTrack = !wasTracked(dep)
    }
  } else {
    // Full cleanup mode.
    // 完全清理模式
    shouldTrack = !dep.has(activeEffect!)
  }
  // 判断是否应该收集
  if (shouldTrack) {
    // 把activeEffect函数放入dep集合中 放入依赖集合
    // activeEffect就是setupRenderEffect中的effect
    console.log('activeEffect', activeEffect)
    dep.add(activeEffect!)
    // deps添加一个dep
    activeEffect!.deps.push(dep)
    
    if (__DEV__ && activeEffect!.onTrack) {
      activeEffect!.onTrack(
        Object.assign(
          {
            effect: activeEffect!
          },
          debuggerEventExtraInfo
        )
      )
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  console.log('trigger')
  // 获取target target: { key: [ activeEffect ] }
  const depsMap = targetMap.get(target)
  // 如果depsMap不存在
  if (!depsMap) {
    // 没有收集依赖
    // never been tracked
    return
  }
  // 创建deps数组
  let deps: (Dep | undefined)[] = []

  if (type === TriggerOpTypes.CLEAR) {
    // 集合被清空
    // collection being cleared
    // 触发所有的依赖
    // trigger all effects for target
    // 展开target里的所有值，并values执行get，触发所有依赖
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) {
    // 触发array的length属性
    // 如果key是length并且target是数组
    // 对forEach进行的操作
    depsMap.forEach((dep, key) => {
      // 如果key是length 或 key >= 新值
      if (key === 'length' || key >= (newValue as number)) {
        // 将dep推入到Deps数组中
        deps.push(dep)
      }
    })
  } else {
    // 计划集合|添加|删除的运行
    // schedule runs for SET | ADD | DELETE
    // 如果 key 不是 空
    if (key !== void 0) {
      // depsMap.get(key) 获取到 key: [ activeEffect ]这个更新函数数组
      // 然后将更新函数数组推入到deps中
      deps.push(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    // 在添加|删除|映射上运行迭代键。设置 设置map和set的ADD DELETE SET
    switch (type) {
      // 如果是ADD类型
      case TriggerOpTypes.ADD:
        // 如果target不是数组
        if (!isArray(target)) {
          // 将ITERATE_KEY对应的更新函数数组(依赖)推入到deps中
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果target是Map
          if (isMap(target)) {
            // 将MAP_KEY_ITERATE_KEY对应的更新函数数组推入到deps中
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // 如果key是整数 新索引添加到数组->长度更改
          // new index added to array -> length changes
          // 长度更改
          deps.push(depsMap.get('length'))
        }
        break
      // 如果是DELETE类型
      case TriggerOpTypes.DELETE:
        // 如果target不是数组
        if (!isArray(target)) {
          // 将ITERATE_KEY对应的更新函数数组推入到deps中
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果target是Map
          if (isMap(target)) { 
            // 将MAP_KEY_ITERATE_KEY对应的更新函数数组推入到deps中
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      // 如果是SET类型
      case TriggerOpTypes.SET:
        // 如果target是Map
        if (isMap(target)) {
          // 将ITERATE_KEY对应的更新函数数组推入到deps中
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }
  // 获取evnetInfo
  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined

  // 如果deps数组长度为1
  if (deps.length === 1) {
    // 如果数组0存在
    if (deps[0]) {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        // triggerEffects
        triggerEffects(deps[0])
      }
    }
  } else {
    // effects数组
    const effects: ReactiveEffect[] = []
    // 遍历deps数组
    for (const dep of deps) {
      // 如果dep存在
      if (dep) {
        // 将dep扩展并推入effects
        effects.push(...dep)
      }
    }
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      // 
      triggerEffects(createDep(effects))
    }
  }
}

export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // spread into array for stabilization
  // 找到相关依赖，循环所有的副作用函数
  for (const effect of isArray(dep) ? dep : [...dep]) {
    // 如果effect不等于activeEffect 或 ffect.allowRecurse
    if (effect !== activeEffect || effect.allowRecurse) {
      if (__DEV__ && effect.onTrigger) {
        effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
      }
      // 如果effect.scheduler
      if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()
      }
    }
  }
}
