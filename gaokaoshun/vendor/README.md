# vendor/ —— 可选：让应用完全离线

页面加载图表库的顺序是：

1. `vendor/echarts.min.js`
2. `vendor/xlsx.full.min.js`
3. 依次回退到 jsDelivr → unpkg → cdnjs

所以只要把这两个文件放进本目录，页面就**不再依赖任何外网**（适合校园网、断网演示、CDN 被墙的情况）。

## 下载地址

| 文件 | 版本 | 地址 |
| --- | --- | --- |
| `echarts.min.js` | 5.4.3 | <https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js> |
| `xlsx.full.min.js` | 0.18.5 | <https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js> |

PowerShell 一条命令搞定：

```powershell
cd 项目根目录
New-Item -ItemType Directory -Force vendor | Out-Null
Invoke-WebRequest https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js -OutFile vendor/echarts.min.js
Invoke-WebRequest https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js -OutFile vendor/xlsx.full.min.js
```

> 这两个 `.js` 已被 `.gitignore` 忽略（体积约 2 MB），所以本目录只会保留这份说明。

放好之后刷新页面即可，无需改代码。
