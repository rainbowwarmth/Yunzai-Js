import plugin from "../../lib/plugins/plugin.js"
import fs from "node:fs"
import path from "node:path"
import common from "../../lib/common/common.js"
import cfg from "../../lib/config/config.js"
import NoteUser from "../genshin/model/mys/NoteUser.js"

const GACHA_BASE_DIR = path.join(process.cwd(), "plugins", "ZZZ-Plugin", "data", "gacha")
const UIGF_SAVE_DIR = path.join(process.cwd(), "temp", "ZZZ-Plugin", "gacha")
const TEMP_FILE_DIR = path.join(process.cwd(), "temp", "ZZZ-Plugin", "temp")
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "plugins", "ZZZ-Plugin",'package.json'), 'utf-8'))
const POOL_KEYS = ['音擎频段', '独家频段', '常驻频段', '邦布频段', '音擎回响', '独家重映']
const GACHA_TYPE_TO_POOL = {
  '1': '常驻频段', '2': '独家频段', '3': '音擎频段',
  '5': '邦布频段', '102': '独家重映', '103': '音擎回响'
}
const UIGF_CONFIG = {
  export_app: "ZZZ-Plugin", export_app_version: pkg.version,
  version: 'v4.0', timezone: 8, lang: 'zh-cn'
}
const PLATFORMS = ["NapCat.Onebot", "LLOneBot"]

/**
 * 绝区零抽卡记录导入/导出记录插件
 * 指令：%导出记录 / %(强制)导入记录
 */
export class ZzzGachaUigf extends plugin {
  constructor() {
    super({
      name: "绝区零:抽卡记录导入/导出记录",
      dsc: "ZZZ-Plugin抽卡记录导入/导出记录",
      event: "message",
      priority: 300,
      rule: [
        { reg: "^#绝区零(强制)?导出记录$", fnc: "zzzToUigf" },
        { reg: "^#绝区零(强制)?导入记录$", fnc: "uigfLogJson" }
      ]
    })
  }

  async init() {
    const needCreateDirs = [GACHA_BASE_DIR, UIGF_SAVE_DIR, TEMP_FILE_DIR]
    for (const dir of needCreateDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        logger.mark(`[绝区零][导入/导出记录] 自动创建目录：${dir}`)
      }
    }
  }

  async zzzToUigf() {
    const e = this.e
    this.e.isForce = !!e.msg.includes("强制")
    if (e.isGroup && !this.e.isForce) {
      return await e.reply(
        `建议私聊导出，群聊请发送【#绝区零强制导出记录】`,
        false,
        { at: true }
      )
    }
    let uigfSaveFile = ""
    try {
      this.User = await NoteUser.create(e)
      const uid = this.User?.getUid('zzz')
      if (!uid || !/^\d+$/.test(uid)) {
        return await e.reply('❌ 未绑定绝区零UID，请先完成绑定', true)
      }

      const gachaFile = path.join(GACHA_BASE_DIR, `${uid}.json`)
      if (!fs.existsSync(gachaFile)) {
        return await e.reply(`❌ 未找到抽卡记录（UID：${uid}）`, true)
      }
      const rawGachaData = JSON.parse(fs.readFileSync(gachaFile, 'utf-8'))
      const uigfData = this.convertToUigfV4(rawGachaData, uid)
      uigfSaveFile = this.createUigfFile(uigfData, uid)
      await e.reply(`✅ 抽卡记录已导出为UIGFv4格式（UID：${uid}）`, true)
      if (e.group?.sendFile) await e.group.sendFile(uigfSaveFile)
      else if (e.friend?.sendFile) await e.friend.sendFile(uigfSaveFile)

    } catch (err) {
      await e.reply(`❌ 导出失败：${err.message}`, true)
      logger.error('[绝区零][导入/导出记录] 导出错误：', err)
    } finally {
      if (uigfSaveFile && fs.existsSync(uigfSaveFile)) {
        fs.unlinkSync(uigfSaveFile)
        logger.mark(`[绝区零][导入/导出记录] 导出完成，已删除UIGF文件：${path.basename(uigfSaveFile)}`)
      }
    }
  }

  async uigfLogJson() {
    const e = this.e
    this.e.isForce = !!e.msg.includes("强制")
    if (e.isGroup && !this.e.isForce) {
      return await e.reply(
        `建议私聊导入，群聊请发送【%强制导入记录】`,
        false,
        { at: true }
      )
    }
    this.setContext("zzzLogJsonFile")
    await e.reply("请发送UIGFv4格式的JSON文件", false, { at: true })
  }

  async zzzLogJsonFile() {
    const e = this.e
    if (!e.file || !e.file.name?.endsWith('.json')) {
      await e.reply("❌ 请发送有效的UIGF JSON文件！", true)
      return false
    }
    this.finish("zzzLogJsonFile")

    let tempFile = ""
    try {
      const isOneBot = PLATFORMS.includes(e.bot?.version?.app_name)
      let [fileid, filename] = this.getFileIdAndName(e)
      tempFile = path.join(TEMP_FILE_DIR, filename || `zzz_uigf_${e.user_id}.json`)
      this.ensureDirectoryExists(path.dirname(tempFile))

      if (isOneBot) {
        const fileRes = await e.bot.sendApi("get_file", { file_id: fileid })
        if (!fileRes?.data) throw new Error("获取文件数据失败")
        if (fileRes.data.base64) {
          const decodedData = Buffer.from(fileRes.data.base64, "base64")
          fs.writeFileSync(tempFile, decodedData)
        } else if (fileRes.data.file && fs.existsSync(fileRes.data.file)) {
          fs.copyFileSync(fileRes.data.file, tempFile)
        } else {
          throw new Error("适配器文件数据无效")
        }
      } else {
        let fileUrl = e.file.url
        if (!fileUrl) {
          if (e.group?.getFileUrl) fileUrl = await e.group.getFileUrl(e.file.fid)
          else if (e.friend?.getFileUrl) fileUrl = await e.friend.getFileUrl(e.file.fid)
          else throw new Error("无法获取文件下载链接")
        }
        const downRes = await common.downFile(fileUrl, tempFile)
        if (!downRes) throw new Error("文件下载失败")
      }

      const uigfData = JSON.parse(fs.readFileSync(tempFile, "utf8"))
      this.checkUigfFormat(uigfData)
      this.User = await NoteUser.create(e)
      const uid = this.User?.getUid('zzz')
      if (!uid || !/^\d+$/.test(uid)) {
        return await e.reply('❌ 未绑定绝区零UID，请先完成绑定', true)
      }

      const newZzzData = this.convertUigfToZzz(uigfData, uid)
      const targetFile = path.join(GACHA_BASE_DIR, `${uid}.json`)
      const finalZzzData = fs.existsSync(targetFile)
        ? this.mergeGachaData(JSON.parse(fs.readFileSync(targetFile, 'utf-8')), newZzzData)
        : newZzzData

      fs.writeFileSync(targetFile, JSON.stringify(finalZzzData, null, 2), 'utf-8')

      let msgArr = []
      let total = 0
      for (let pool of POOL_KEYS) {
        let cnt = newZzzData[pool]?.length || 0
        if (cnt > 0) {
          msgArr.push(`${pool}：${cnt}条`)
          total += cnt
        }
      }

      let replyMsg = [`✅ UIGF抽卡记录导入成功（UID：${uid}）`, ...msgArr, `总计：${total}条`].join("\n")
      await e.reply(replyMsg, true)
      if (e.isGroup) await e.reply("已收到文件，请撤回", false, { at: true })

    } catch (err) {
      await e.reply(`❌ 导入失败：${err.message}`, true)
      logger.error('[绝区零][导入/导出记录] 导入错误：', err)
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  }

  getFileIdAndName(e) {
    let fileid, filename
    if (cfg.package?.name === 'miao-yunzai') {
      fileid = e.message_type === "private" ? e.message[0].file_id : e.message[0].id
      filename = e.message_type === "private" ? e.message[0].file : e.message[0].name
    } else {
      fileid = e.message_type === "private" ? e.file.file_id : e.file.id
      filename = e.message_type === "private" ? e.file.file : e.file.name
    }
    return [fileid, filename]
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
      throw new Error('UIGF格式不合法，缺少info/nap')
    }
    const napItem = uigfData.nap[0]
    if (!napItem?.list || napItem.list.length === 0) {
      throw new Error('UIGF中无有效抽卡记录')
    }
  }

  /**
   * UIGF → 绝区零
   */
  convertUigfToZzz(uigfData, uid) {
    const zzzData = POOL_KEYS.reduce((obj, key) => ({ ...obj, [key]: [] }), {})
    const uigfList = uigfData.nap[0].list
    uigfList.forEach(item => {
      const gachaType = item.uigf_gacha_type || item.gacha_type
      const targetPool = GACHA_TYPE_TO_POOL[String(gachaType)]
      if (targetPool) zzzData[targetPool].push({ ...item, uid })
    })
    const total = Object.values(zzzData).reduce((s, arr) => s + arr.length, 0)
    if (total === 0) throw new Error('无匹配的绝区零抽卡记录')
    return zzzData
  }

  /**
   * 合并去重 + 时间排序
   */
  mergeGachaData(oldData, newData) {
    const merged = POOL_KEYS.reduce((obj, key) => ({ ...obj, [key]: [] }), {})
    POOL_KEYS.forEach(pool => {
      const all = [...(oldData[pool] || []), ...(newData[pool] || [])]
      const map = new Map()
      all.forEach(item => item.id && !map.has(item.id) && map.set(item.id, item))
      merged[pool] = Array.from(map.values()).sort((a, b) => new Date(b.time) - new Date(a.time))
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
   * 绝区零 → UIGFv4
   */
  convertToUigfV4(rawGacha, uid) {
    const list = POOL_KEYS.reduce((l, k) => l.concat(rawGacha[k] || []), [])
    if (list.length === 0) throw new Error('无有效抽卡记录')
    const uigfList = list.map(item => ({ ...item, uigf_gacha_type: item.gacha_type }))
    const now = new Date()
    const exportTime = new Date(now.getTime() + (8 * 60 - now.getTimezoneOffset()) * 60 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ')
    return {
      info: {
        export_time: exportTime,
        export_timestamp: Math.floor(now.getTime() / 1000).toString(),
        ...UIGF_CONFIG
      },
      nap: [{ uid, timezone: 8, lang: 'zh-cn', list: uigfList }]
    }
  }
}
