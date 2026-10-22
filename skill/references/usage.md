# mcd-meal CLI 参考

> 规范化 Skill 源的一部分。CLI 命令：`{{CLI}}`（随技能打包的单文件 `scripts/mcd-meal.mjs`，无需仓库/依赖）。

## 子命令

| 子命令 | 说明 |
|--------|------|
| `recommend` | 生成套餐推荐（1 主推 + ≤2 备选 + ≥2 理由 + 券后价） |
| `onboarding` | 输出「待问清单」（冷启动引导；已具备画像时为空） |
| `configure` | 将采集答案写入画像（位置/取餐方式/预算/口味/忌口/营养） |
| `reset-profile` | 重置画像（**破坏性**，须 `--confirmed`） |
| `set-reminder` | 设定就餐提醒（支持生效日/提前量/免打扰/时区） |
| `show-profile` | 查看脱敏口味画像 |
| `bind-coupons` | 领取优惠券（**写操作**，须 `--confirmed` 才执行） |
| `chat`（缺省） | 对话式：先判断提醒是否到点，到点则「提醒 + 推荐」 |

## 参数

| 参数 | 取值 | 映射 |
|------|------|------|
| `--meal-type` | `lunch` / `dinner` | `mealType` |
| `--city` | 字符串 | `city` |
| `--channel` | `delivery` / `nearby` | `channel`（取餐方式） |
| `--store-code` | 字符串 | `storeCode`（直接指定门店） |
| `--address-id` | 字符串 | `addressId`（麦乐送） |
| `--budget-min` / `--budget-max` | 数字（元） | `budget` |
| `--max-kcal` / `--min-protein` | 数字 | `nutritionGoal` |
| `--taste` | 逗号分隔标签（辣/清淡/甜/鸡/牛/鱼） | `tasteTags` |
| `--allergy` | 逗号分隔（牛肉/猪肉/鸡肉/海鲜/乳制品/花生坚果/蛋/大豆） | `allergies`（过敏原） |
| `--avoid` | 逗号分隔（同上标签集） | `avoid`（忌口） |
| `--clear` | 逗号分隔维度（location/taste/budget/nutrition/dietary） | `clearFields` |
| `--scene` | `auto`/`quick`/`save`/`fit`/`treat`/`late` | `scene`（场景模式） |
| `--exclude` | 逗号分隔套餐 code | `excludeCodes`（"换一换"，纯排除） |
| `--rejected` | 套餐 code | `rejectedMealCode`（记负反馈并排除） |
| `--dislike-taste` | 口味标签 | `dislikeTaste`（口味纠偏：移除标签并抑制匹配品类） |
| `--time` | `HH:mm` | `time` |
| `--days` | 逗号分隔 0-6（0=周日） | `days` |
| `--advance-minutes` | 整数 | `advanceMinutes` |
| `--quiet-start` / `--quiet-end` | `HH:mm` | `quietHours` |
| `--timezone` | IANA（如 `Asia/Shanghai`） | `timezone` |
| `--selected` | 套餐 code | `selectedMealCode`（强权重画像） |
| `--accepted` | 布尔 | `accepted`（弱权重起始画像） |
| `--confirmed` | 布尔 | `confirmed`（领券 / 重置画像 写操作确认） |
| `--json` | 布尔 | 输出完整结构化 JSON |
| `-h, --help` | — | 帮助 |

## 环境变量

| 变量 | 说明 |
|------|------|
| `MCD_MCP_TOKEN` | 麦当劳 MCP 鉴权 Token；缺省则离线降级 |
| `MCD_OFFLINE` | `=1` 强制离线演示数据（零 MCP 调用） |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error`（默认 `info`） |
| `MCD_DATA_DIR` | 本地数据目录（默认=本技能 CLI 所在技能/仓库根目录下 `data/`，即 `<skillDir>/data`，v1.3.0；相对值归一化为绝对） |
| `MCD_PROFILE_PATH` | 画像文件（默认 `<数据目录>/profile.json`） |
| `MCD_PROFILE_NEGATIVE_BETA` | 负反馈 EMA 系数（默认 0.3） |
| `MCD_REMINDER_CONFIG_PATH` / `MCD_REMINDER_STATE_PATH` | 提醒配置/状态（默认 `<数据目录>/reminder-*.json`） |
| `MCD_PROFILE_TIMEZONE` | 画像时段归类时区（默认设备时区） |

## 示例

```bash
mcd-meal onboarding                                      # 冷启动：获取待问清单
mcd-meal configure --city 上海 --channel nearby --budget-min 20 --budget-max 40 --taste 辣,鸡
mcd-meal configure --allergy 乳制品 --avoid 牛肉      # 过敏原 / 忌口
mcd-meal configure --clear taste                      # 清除口味维度
mcd-meal reset-profile                                # 请求确认
mcd-meal reset-profile --confirmed                    # 确认重置画像
MCD_OFFLINE=1 mcd-meal recommend --meal-type lunch --scene save
mcd-meal recommend --exclude M001                       # 换一换
mcd-meal recommend --rejected M003                       # 拒绝某套餐（记负反馈）
mcd-meal recommend --dislike-taste 辣                    # 口味纠偏
mcd-meal set-reminder --meal-type dinner --time 18:30 --days 1,3,5
mcd-meal show-profile
mcd-meal bind-coupons            # 列出并请求确认
mcd-meal bind-coupons --confirmed
```

## 退出码

| 码 | 含义 |
|----|------|
| `0` | 成功（含业务侧友好提示；`handleRequest` 永不抛出） |
| `2` | CLI 参数解析错误 |
