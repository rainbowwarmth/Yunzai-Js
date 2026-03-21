import plugin from "../../lib/plugins/plugin.js"
import fs from "node:fs"
import path from "node:path"
import common from "../../lib/common/common.js"
import NoteUser from "../genshin/model/mys/NoteUser.js"

const GACHA_BASE_DIR = path.join(process.cwd(), "plugins", "ZZZ-Plugin", "data", "gacha")
const UIGF_SAVE_DIR = path.join(process.cwd(), "temp", "ZZZ-Plugin", "gacha")
const TEMP_FILE_DIR = path.join(process.cwd(), "temp", "ZZZ-Plugin", "temp")
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "plugins", "ZZZ-Plugin", 'package.json'), 'utf-8'))
const POOL_KEYS = ['音擎频段', '独家频段', '常驻频段', '邦布频段', '音擎回响', '独家重映']
const GACHA_TYPE_TO_POOL = {
  '1': '常驻频段',
  '2': '独家频段',
  '3': '音擎频段',
  '5': '邦布频段',
  '102': '独家重映',
  '103': '音擎回响'
}
const UIGF_CONFIG = {
  export_app: "ZZZ-Plugin",
  export_app_version: pkg.version,
  version: 'v4.0',
  timezone: 8,
  lang: 'zh-cn'
}
const PLATFORMS = ["NapCat.Onebot", "LLOneBot"]

/**
 * 绝区零抽卡记录导入/导出记录插件
 * 指令：#绝区零导出记录 / #绝区零(强制)导入记录
 */
export class ZzzGachaUigf extends plugin {
  constructor() {
    super({
      name: "绝区零:抽卡记录导入/导出记录",
      dsc: "ZZZ-Plugin抽卡记录导入/导出记录",
      event: "message",
      priority: 300,
      rule: [{
          reg: "^#绝区零(强制)?导出记录$",
          fnc: "zzzToUigf"
        },
        {
          reg: "^#绝区零(强制)?导入记录$",
          fnc: "uigfLogJson"
        }
      ]
    })
  }

  async init() {
    try {
      logger.debug(`[绝区零][导入/导出记录] 开始初始化目录`)
      const needCreateDirs = [GACHA_BASE_DIR, UIGF_SAVE_DIR, TEMP_FILE_DIR]
      for (const dir of needCreateDirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, {
            recursive: true
          })
          logger.debug(`[绝区零][导入/导出记录] 自动创建目录：${dir}`)
        } else {
          logger.debug(`[绝区零][导入/导出记录] 目录已存在：${dir}`)
        }
      }
      logger.debug(`[绝区零][导入/导出记录] 初始化完成`)
    } catch (err) {
      console.error('[绝区零][导入/导出记录] 初始化失败：', err.stack)
    }
  }

  async zzzToUigf() {
    const e = this.e
    this.e.isForce = !!e.msg.includes("强制")
    if (e.isGroup && !this.e.isForce) {
      return await e.reply(
        `建议私聊导出，群聊请发送【%强制导出记录】`,
        false, {
          at: true
        }
      )
    }
    let uigfSaveFile = ""
    try {
      logger.debug(`[绝区零][导出记录] 用户${e.user_id}触发导出指令，群聊/私聊：${e.isGroup ? '群聊' : '私聊'}`)
      this.User = await NoteUser.create(e)
      const uid = this.User?.getUid('zzz')
      if (!uid || !/^\d+$/.test(uid)) {
        logger.debug(`[绝区零][导出记录] 用户${e.user_id}未绑定UID或UID格式错误：${uid}`)
        return await e.reply('❌ 未绑定绝区零UID，请先完成绑定', true)
      }

      const gachaFile = path.join(GACHA_BASE_DIR, `${uid}.json`)
      logger.debug(`[绝区零][导出记录] 文件试读取抽卡记录文件：${gachaFile}`)
      if (!fs.existsSync(gachaFile)) {
        logger.debug(`[绝区零][导出记录] 未找到抽卡记录文件（UID：${uid}）`)
        return await e.reply(`❌ 未找到抽卡记录（UID：${uid}）`, true)
      }

      const rawGachaData = JSON.parse(fs.readFileSync(gachaFile, 'utf-8'))
      logger.debug(`[绝区零][导出记录] 读取到抽卡记录，开始转换为UIGF格式`)
      const uigfData = this.convertToUigfV4(rawGachaData, uid)
      uigfSaveFile = this.createUigfFile(uigfData, uid)
      logger.debug(`[绝区零][导出记录] UIGF文件已生成：${uigfSaveFile}`)
      await e.reply(`✅ 抽卡记录已导出为UIGFv4格式（UID：${uid}）`, true)

      if (e.group?.sendFile) {
        logger.debug(`[绝区零][导出记录] 群聊发送文件：${uigfSaveFile}`)
        await e.group.sendFile(uigfSaveFile)
      } else if (e.friend?.sendFile) {
        logger.debug(`[绝区零][导出记录] 私聊发送文件：${uigfSaveFile}`)
        await e.friend.sendFile(uigfSaveFile)
      }
    } catch (err) {
      await e.reply(`❌ 导出失败：${err.message}`, true)
      logger.error('[绝区零][导入/导出记录] 导出错误：', err)
    } finally {
      if (uigfSaveFile && fs.existsSync(uigfSaveFile)) {
        fs.unlinkSync(uigfSaveFile)
        logger.debug(`[绝区零][导出记录] 已删除临时UIGF文件：${uigfSaveFile}`)
      }
    }
  }

  async uigfLogJson() {
    const e = this.e
    this.e.isForce = !!e.msg.includes("强制")
    if (e.isGroup && !this.e.isForce) {
      return await e.reply(
        `建议私聊导入，群聊请发送【%强制导入记录】`,
        false, {
          at: true
        }
      )
    }
    this.setContext("zzzLogJsonFile")
    await e.reply("请发送UIGFv4格式的JSON文件", false, {
      at: true
    })
    logger.debug(`[绝区零][导入记录] 已设置上下文，等待用户发送文件`)
  }

  async zzzLogJsonFile() {
    const e = this.e
    logger.debug(`[绝区零][导入记录] 收到用户${e.user_id}的文件消息：`, JSON.stringify(e.file, null, 2))

    let fileName = e.file?.name || e.file?.file || e.message[0]?.file || e.message[0]?.name || ''
    if (!fileName && e.raw_message) {
      const cqFileMatch = e.raw_message.match(/\[CQ:file,.*?file=([^,]+).*?\]/)
      if (cqFileMatch?.[1]) {
        fileName = cqFileMatch[1]
        logger.debug(`[绝区零][导入记录] 从CQ码解析出文件名：${fileName}`)
      }
    }

    const isJsonFile = fileName.toLowerCase().endsWith('.json')
    if (!e.file || !isJsonFile) {
      logger.debug(`[绝区零][导入记录] 用户${e.user_id}发送的不是JSON文件，实际文件名：${fileName}`)
      await e.reply("❌ 请发送有效的UIGF JSON文件！", true)
      return false
    }

    this.finish("zzzLogJsonFile")
    let tempFile = ""
    try {
      const isOneBot = PLATFORMS.includes(e.bot?.version?.app_name)
      const fileid = e.file?.file_id || e.file?.id || e.message[0]?.file_id || e.message[0]?.id || ''
      tempFile = path.join(TEMP_FILE_DIR, fileName || `zzz_uigf_${e.user_id}.json`)
      this.ensureDirectoryExists(path.dirname(tempFile))
      logger.debug(`[绝区零][导入记录] 文件信息 - fileid: ${fileid}, 文件名：${fileName}, isOneBot: ${isOneBot}`)
      logger.debug(`[绝区零][导入记录] 临时文件路径：${tempFile}`)

      if (isOneBot) {
        logger.debug(`[绝区零][导入记录] 使用OneBot适配器获取文件`)
        let fileUrl = null
        try {
          if (e.message_type === 'group' || e.isGroup) {
            logger.debug(`[绝区零][导入记录] 调用 get_group_file_url，群号：${e.group_id}，file_id：${fileid}`)
            const groupFileRes = await e.bot.sendApi("get_group_file_url", {
              group_id: Number(e.group_id),
              file_id: fileid
            })
            logger.debug(`[绝区零][导入记录] get_group_file_url 返回：`, JSON.stringify(groupFileRes, null, 2))
            if (groupFileRes?.data?.url) fileUrl = groupFileRes.data.url
          } else {
            logger.debug(`[绝区零][导入记录] 调用 get_private_file_url，file_id：${fileid}`)
            const privateFileRes = await e.bot.sendApi("get_private_file_url", {
              file_id: fileid
            })
            logger.debug(`[绝区零][导入记录] get_private_file_url 返回：`, JSON.stringify(privateFileRes, null, 2))
            if (privateFileRes?.data?.url) fileUrl = privateFileRes.data.url
          }
        } catch (urlErr) {
          console.warn(`[绝区零][导入记录] 获取文件URL失败，尝试降级方案：`, urlErr.message)
        }

        if (fileUrl) {
          logger.debug(`[绝区零][导入记录] 通过URL下载文件：${fileUrl}`)
          const downRes = await common.downFile(fileUrl, tempFile)
          if (!downRes) throw new Error("文件下载失败")
          logger.debug(`[绝区零][导入记录] 文件下载完成：${tempFile}`)
        } else {
          logger.debug(`[绝区零][导入记录] 降级调用 get_file 接口`)
          const fileRes = await e.bot.sendApi("get_file", {
            file_id: fileid
          })
          logger.debug(`[绝区零][导入记录] get_file 返回：`, JSON.stringify(fileRes, null, 2))
          if (!fileRes?.data) throw new Error("获取文件数据失败")

          if (fileRes.data.base64) {
            logger.debug(`[绝区零][导入记录] 从base64解码文件`)
            fs.writeFileSync(tempFile, Buffer.from(fileRes.data.base64, "base64"))
          } else if (fileRes.data.file && fs.existsSync(fileRes.data.file)) {
            logger.debug(`[绝区零][导入记录] 复制文件：${fileRes.data.file} → ${tempFile}`)
            fs.copyFileSync(fileRes.data.file, tempFile)
          } else {
            throw new Error("适配器文件数据无效")
          }
        }
      } else {
        logger.debug(`[绝区零][导入记录] 使用URL下载文件`)
        let fileUrl = e.file.url
        if (!fileUrl) {
          if (e.group?.getFileUrl) fileUrl = await e.group.getFileUrl(e.file.fid)
          else if (e.friend?.getFileUrl) fileUrl = await e.friend.getFileUrl(e.file.fid)
          else throw new Error("无法获取文件下载链接")
        }
        logger.debug(`[绝区零][导入记录] 文件下载链接：${fileUrl}`)
        const downRes = await common.downFile(fileUrl, tempFile)
        if (!downRes) throw new Error("文件下载失败")
        logger.debug(`[绝区零][导入记录] 文件下载完成：${tempFile}`)
      }

      const uigfData = JSON.parse(fs.readFileSync(tempFile, "utf8"))
      logger.debug(`[绝区零][导入记录] 读取UIGF文件完成，开始校验格式`)
      this.checkUigfFormat(uigfData)

      this.User = await NoteUser.create(e)
      const uid = this.User?.getUid('zzz')
      if (!uid || !/^\d+$/.test(uid)) {
        logger.debug(`[绝区零][导入记录] 用户${e.user_id}未绑定UID或UID格式错误：${uid}`)
        return await e.reply('❌ 未绑定绝区零UID，请先完成绑定', true)
      }

      const newZzzData = this.convertUigfToZzz(uigfData, uid)
      const targetFile = path.join(GACHA_BASE_DIR, `${uid}.json`)
      const finalZzzData = fs.existsSync(targetFile) ?
        this.mergeGachaData(JSON.parse(fs.readFileSync(targetFile, 'utf-8')), newZzzData) :
        newZzzData

      fs.writeFileSync(targetFile, JSON.stringify(finalZzzData, null, 2), 'utf-8')

      let msgArr = []
      let total = 0
      for (const pool of POOL_KEYS) {
        const cnt = newZzzData[pool]?.length || 0
        if (cnt > 0) {
          msgArr.push(`${pool}：${cnt}条`)
          total += cnt
        }
      }

      await e.reply([`✅ UIGF抽卡记录导入成功（UID：${uid}）`, ...msgArr, `总计：${total}条`].join("\n"), true)
      if (e.isGroup) await e.reply(`已收到${fileName}文件，请撤回`, false, {
        at: true
      })

    } catch (err) {
      await e.reply(`❌ 导入失败：${err.message}`, true)
      logger.error('[绝区零][导入/导出记录] 导入错误：', err)
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  }

  /**
   * 递归创建目录
   */
  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      const parentDir = path.dirname(dirPath)
      if (parentDir !== dirPath) this.ensureDirectoryExists(parentDir)
      fs.mkdirSync(dirPath)
      logger.mark(`[绝区零][导入/导出记录] 已创建目录: ${dirPath}`)
    }
  }

  /**
   * 校验UIGFv4格式
   */
  checkUigfFormat(uigfData) {
    if (!uigfData?.info || !uigfData?.nap || !Array.isArray(uigfData.nap)) {
      throw new Error('UIGF格式不合法，缺少info/nap字段')
    }
    const napItem = uigfData.nap[0]
    if (!napItem?.list || napItem.list.length === 0) {
      throw new Error('UIGF中无有效抽卡记录')
    }
  }

  /**
   * UIGF → 绝区零本地格式
   */
  convertUigfToZzz(uigfData, uid) {
    const zzzData = POOL_KEYS.reduce((obj, key) => ({
      ...obj,
      [key]: []
    }), {})
    let list = uigfData.nap[0].list
    if (list.length > 1) {
      const firstTime = new Date(list[0].time).getTime()
      const lastTime = new Date(list[list.length - 1].time).getTime()
      if (firstTime < lastTime) list = list.slice().reverse()
    }

    for (const item of list) {
      const gachaType = String(item.gacha_type)
      const targetPool = GACHA_TYPE_TO_POOL[gachaType]
      if (!targetPool) continue
      const normalized = {
        uid: String(uid),
        gacha_id: item.gacha_id ?? "0",
        gacha_type: gachaType,
        item_id: Number(item.item_id),
        count: String(item.count ?? "1"),
        time: item.time,
        name: item.name,
        lang: item.lang ?? "zh-cn",
        item_type: item.item_type,
        rank_type: String(item.rank_type),
        id: String(item.id),
        square_icon: item.square_icon ?? ""
      }

      zzzData[targetPool].push(normalized)
    }

    const total = Object.values(zzzData).reduce((s, arr) => s + arr.length, 0)
    if (total === 0) throw new Error('无匹配的绝区零抽卡记录')

    return zzzData
  }

  /**
   * 合并去重 + 统一倒序（新→旧）
   */
  mergeGachaData(oldData, newData) {
    const merged = POOL_KEYS.reduce((obj, key) => ({
      ...obj,
      [key]: []
    }), {})
    POOL_KEYS.forEach(pool => {
      const all = [...(oldData[pool] || []), ...(newData[pool] || [])]
      const map = new Map()
      all.forEach(item => item.id && !map.has(item.id) && map.set(item.id, item))
      merged[pool] = Array.from(map.values()).sort(
        (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
      )
    })
    return merged
  }

  /**
   * 生成UIGF导出文件
   */
  createUigfFile(uigfData, uid) {
    const fileName = `zenless_${uid}_uigfv4_${Date.now()}.json`
    const savePath = path.join(UIGF_SAVE_DIR, fileName)
    fs.writeFileSync(savePath, JSON.stringify(uigfData, null, 2), 'utf-8')
    return savePath
  }

  /**
   * 绝区零本地格式 → UIGFv4
   */
  convertToUigfV4(rawGacha, uid) {
    let list = []
    for (const poolKey of POOL_KEYS) {
      const gachaType = Object.entries(GACHA_TYPE_TO_POOL).find(([k, v]) => v === poolKey)?.[0]
      if (!gachaType) continue
      const arr = (rawGacha[poolKey] || []).map(item => ({
        uid: String(uid),
        id: String(item.id),
        gacha_type: String(gachaType),
        name: item.name,
        item_type: item.item_type,
        rank_type: String(item.rank_type),
        time: item.time,
        item_id: String(item.item_id),
        count: String(item.count ?? "1"),
        lang: item.lang ?? "zh-cn"
      }))
      list = list.concat(arr)
    }
    if (list.length === 0) throw new Error('无有效抽卡记录')
    list.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    const now = new Date()
    const exportTime = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ')

    return {
      info: {
        export_time: exportTime,
        export_timestamp: Math.floor(now.getTime() / 1000).toString(),
        ...UIGF_CONFIG
      },
      nap: [{
        uid,
        timezone: 8,
        lang: 'zh-cn',
        list
      }]
    }
  }
}
