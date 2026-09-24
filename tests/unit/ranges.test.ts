import { describe, expect, it } from 'vitest'
import { UserError, parseRangeGroups, parseRanges } from '../../src/shared/ranges'

describe('页码范围解析', () => {
  it('空字符串表示全部页面', () => {
    expect(parseRanges('', 3)).toEqual([0, 1, 2])
    expect(parseRanges(undefined, 2)).toEqual([0, 1])
    expect(parseRanges('  ', 2)).toEqual([0, 1])
  })

  it('单页、区间、开放区间', () => {
    expect(parseRanges('1-3,5', 10)).toEqual([0, 1, 2, 4])
    expect(parseRanges('8-', 10)).toEqual([7, 8, 9])
    expect(parseRanges('-2', 10)).toEqual([0, 1])
  })

  it('倒序区间', () => {
    expect(parseRanges('5-3', 10)).toEqual([4, 3, 2])
  })

  it('兼容中文标点和空格', () => {
    expect(parseRanges(' 1 – 2 ， 4～5、7 ', 10)).toEqual([0, 1, 3, 4, 6])
    expect(parseRanges('1到3', 10)).toEqual([0, 1, 2])
  })

  it('按组解析', () => {
    expect(parseRangeGroups('1-2,3,4-5', 5)).toEqual([[0, 1], [2], [3, 4]])
  })

  it('超出范围给出中文提示', () => {
    expect(() => parseRanges('11', 10)).toThrow(UserError)
    expect(() => parseRanges('11', 10)).toThrow('页码 11 超出范围（文件共 10 页）')
    expect(() => parseRanges('0', 10)).toThrow('超出范围')
  })

  it('格式错误给出中文提示', () => {
    expect(() => parseRanges('a-b', 10)).toThrow('格式不正确')
    expect(() => parseRanges('1-2-3', 10)).toThrow('格式不正确')
    expect(() => parseRanges('1.5', 10)).toThrow('格式不正确')
    expect(() => parseRangeGroups(',,', 10)).toThrow('请填写页码范围')
  })
})
