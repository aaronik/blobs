import * as BABYLON from 'babylonjs'
import 'babylonjs-loaders'
import { BotAction, BotRuntime, BotSide, BotState, ControllerConfig } from './bots'

export type GameStatus = 'playing' | 'won' | 'lost'
export type GameSnapshot = {
  playerNodes: number
  enemyNodes: number
  neutralNodes: number
  status: GameStatus
  selected: boolean
}

export type Side = 'player' | 'enemy' | 'neutral'
type Team = Side
type Node = {
  id: string
  team: Team
  energy: number
  maxEnergy: number
  neutralInfluence: number
  neutralResistance: number
  position: BABYLON.Vector3
  root: BABYLON.Mesh
  shell: BABYLON.Mesh
  visual?: BABYLON.AbstractMesh
  motes: BABYLON.Mesh[]
  selectionHalo: BABYLON.Mesh
  selectionHaloOuter: BABYLON.Mesh
  selectionFade: number
  outputCursor: number
  fireCooldown: number
  orbitPhase: number
  label: BABYLON.Mesh
  texture: BABYLON.DynamicTexture
}

type ConnectionUnit = {
  mesh: BABYLON.Mesh
  trail: BABYLON.TrailMesh
  path: BABYLON.Vector3[]
  pathLength: number
  progress: number
  team: Exclude<Team, 'neutral'>
}

type Link = {
  key: string
  from: Node
  to: Node
  units: ConnectionUnit[]
  firing: boolean
  path: BABYLON.Vector3[]
}

const COLORS: Record<Team, BABYLON.Color3> = {
  player: BABYLON.Color3.FromHexString('#52f6d2'),
  enemy: BABYLON.Color3.FromHexString('#ff4f91'),
  neutral: BABYLON.Color3.FromHexString('#8b91a8'),
}

const ASSET_FOR_TEAM: Record<Team, string> = {
  player: 'greenEnergyBall.glb',
  enemy: 'pinkEnergyBall.glb',
  neutral: 'yellowEnergyBall.glb',
}

type LevelNode = {
  x: number
  y: number
  z: number
  team: Team
  energy: number
  max: number
}

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
const isNear = (position: BABYLON.Vector3, candidate: BABYLON.Vector3) => {
  const dx = position.x - candidate.x
  const dy = position.y - candidate.y
  const dz = position.z - candidate.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz) < 4
}

const isTooCloseToAny = (positions: BABYLON.Vector3[], candidate: BABYLON.Vector3) => {
  for (const position of positions) if (isNear(position, candidate)) return true
  return false
}

const generateLevel = (): LevelNode[] => {
  const count = randomInt(7, 12)
  const positions: BABYLON.Vector3[] = []

  for (let i = 0; i < count; i += 1) {
    let candidate = BABYLON.Vector3.Zero()
    let attempts = 0
    do {
      candidate = new BABYLON.Vector3(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 14,
      )
      attempts += 1
    } while (attempts < 100 && isTooCloseToAny(positions, candidate))
    positions.push(candidate)
  }

  const teamMax = randomInt(80, 200)
  const teamStartingEnergy = Math.round(teamMax * (0.42 + Math.random() * 0.14))

  return positions.map((position, index) => {
    const team: Team = index === 0 ? 'player' : index === count - 1 ? 'enemy' : 'neutral'
    const max = team === 'neutral' ? randomInt(45, 200) : teamMax
    const energy = team === 'neutral'
      ? max
      : teamStartingEnergy
    return {
      x: position.x,
      y: position.y,
      z: position.z,
      team,
      max,
      energy,
    }
  })
}

const makeMaterial = (scene: BABYLON.Scene, name: string, color: BABYLON.Color3, alpha = 1) => {
  const material = new BABYLON.StandardMaterial(name, scene)
  material.diffuseColor = color.scale(0.32)
  material.emissiveColor = color
  material.specularColor = color
  material.alpha = alpha
  return material
}

const getFireInterval = (node: Node) => {
  const strength = Math.max(0, Math.min(1, node.energy / 200))
  const baseInterval = 1.3 - Math.pow(strength, 0.7) * 1.05
  const lowEnergyPenalty = node.energy <= 6 ? (7 - node.energy) * 0.12 : 0
  return Math.max(0.22, baseInterval + lowEnergyPenalty)
}

export type GameOptions = {
  onUpdate?: (state: GameSnapshot) => void
  controllers?: Record<BotSide, ControllerConfig>
  getTimeScale?: () => number
}

const game = (canvas: HTMLCanvasElement, options: GameOptions = {}) => {
  const onUpdate = options.onUpdate
  const controllers: Record<BotSide, ControllerConfig> = options.controllers || {
    player: { kind: 'human', name: 'Human' },
    enemy: { kind: 'default', name: 'Default AI' },
  }
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color4(0.018, 0.025, 0.065, 1)
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2
  scene.fogDensity = 0.012
  scene.fogColor = new BABYLON.Color3(0.018, 0.025, 0.065)

  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.05, 28, BABYLON.Vector3.Zero(), scene)
  camera.lowerRadiusLimit = 18
  camera.upperRadiusLimit = 42
  camera.wheelPrecision = 35
  camera.panningSensibility = 90
  camera.inertia = 0.82
  camera.angularSensibilityX = 1400
  camera.angularSensibilityY = 1400
  camera.attachControl(canvas, true)

  scene.imageProcessingConfiguration.contrast = 1.2
  scene.imageProcessingConfiguration.exposure = 1.05
  scene.imageProcessingConfiguration.vignetteEnabled = true
  scene.imageProcessingConfiguration.vignetteWeight = 1.4
  scene.imageProcessingConfiguration.vignetteColor = new BABYLON.Color4(0.005, 0.008, 0.03, 1)

  const light = new BABYLON.HemisphericLight('ambient', new BABYLON.Vector3(0, 1, 0), scene)
  light.intensity = 0.45
  const point = new BABYLON.PointLight('center-light', new BABYLON.Vector3(0, 8, 0), scene)
  point.diffuse = BABYLON.Color3.FromHexString('#8d8cff')
  point.intensity = 0.55

  const glow = new BABYLON.GlowLayer('glow', scene, { blurKernelSize: 32 })
  glow.intensity = 0.75

  type CombatTeam = Exclude<Team, 'neutral'>
  const projectileMaterials = {} as Record<CombatTeam, BABYLON.StandardMaterial>
  const trailMaterials = {} as Record<CombatTeam, BABYLON.StandardMaterial>
  const impactMaterials = {} as Record<CombatTeam, BABYLON.StandardMaterial>
  const captureWaveMaterials = {} as Record<CombatTeam, BABYLON.StandardMaterial>
  const captureMoteMaterials = {} as Record<CombatTeam, BABYLON.StandardMaterial>
  ;(['player', 'enemy'] as CombatTeam[]).forEach(team => {
    projectileMaterials[team] = makeMaterial(scene, `unit-mat-${team}`, COLORS[team])
    trailMaterials[team] = makeMaterial(scene, `unit-trail-mat-${team}`, COLORS[team], 0.68)
    impactMaterials[team] = makeMaterial(scene, `impact-mat-${team}`, COLORS[team], 0.9)
    captureWaveMaterials[team] = makeMaterial(scene, `capture-wave-mat-${team}`, COLORS[team], 0.45)
    captureMoteMaterials[team] = makeMaterial(scene, `capture-mote-mat-${team}`, COLORS[team])
  })

  const floor = BABYLON.MeshBuilder.CreateDisc('arena', { radius: 16, tessellation: 80 }, scene)
  floor.rotation.x = Math.PI / 2
  floor.position.y = -3.6
  floor.material = makeMaterial(scene, 'arena-mat', BABYLON.Color3.FromHexString('#202958'), 0.12)
  floor.isPickable = false

  ;[6, 11, 16].forEach((diameter, index) => {
    const ring = BABYLON.MeshBuilder.CreateTorus(`arena-ring-${index}`, { diameter: diameter * 2, thickness: 0.025, tessellation: 96 }, scene)
    ring.position.y = -3.5 + index * 0.025
    ring.material = makeMaterial(scene, `arena-ring-mat-${index}`, BABYLON.Color3.FromHexString('#5263b7'), 0.2 - index * 0.035)
    ring.isPickable = false
  })

  for (let i = 0; i < 90; i += 1) {
    const star = BABYLON.MeshBuilder.CreateSphere(`star-${i}`, { diameter: 0.025 + Math.random() * 0.045, segments: 3 }, scene)
    star.position.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 32)
    star.material = makeMaterial(scene, `star-mat-${i}`, new BABYLON.Color3(0.35 + Math.random() * 0.4, 0.4, 0.8), 0.5)
    star.isPickable = false
  }

  const level = generateLevel()
  const nodes: Node[] = []
  const links = new Map<string, Link>()
  let selected: Node | null = null
  let status: GameStatus = 'playing'
  let elapsed = 0
  let aiTimer = 1.2
  let botDecisionPending = false
  let disposed = false
  const botRuntimes: Partial<Record<BotSide, BotRuntime>> = {}
  ;(['player', 'enemy'] as BotSide[]).forEach(side => {
    const controller = controllers[side]
    if (controller.kind === 'bot') botRuntimes[side] = new BotRuntime(controller.source, controller.name)
  })
  const modelCache = {} as Record<Team, Promise<BABYLON.AbstractMesh>>

  const getModelPrototype = (team: Team) => {
    if (!modelCache[team]) {
      modelCache[team] = BABYLON.SceneLoader.ImportMeshAsync('', '/', ASSET_FOR_TEAM[team], scene).then(result => {
        const prototype = result.meshes[0]
        prototype.computeWorldMatrix(true)
        result.meshes.forEach(mesh => mesh.computeWorldMatrix(true))
        const bounds = prototype.getHierarchyBoundingVectors(true)
        const dimensions = bounds.max.subtract(bounds.min)
        const nativeDiameter = Math.max(dimensions.x, dimensions.y, dimensions.z)
        if (nativeDiameter > 0) prototype.scaling.scaleInPlace(1.9 / nativeDiameter)
        prototype.computeWorldMatrix(true)
        prototype.getChildMeshes(false).forEach(mesh => {
          mesh.isPickable = false
          if (team === 'neutral') {
            const material = new BABYLON.PBRMaterial(`neutral-prototype-${mesh.name}`, scene)
            material.albedoColor = COLORS.neutral.scale(0.42)
            material.emissiveColor = COLORS.neutral.scale(0.55)
            material.metallic = 0.12
            material.roughness = 0.48
            mesh.material = material
          }
        })
        prototype.setEnabled(false)
        return prototype
      })
    }
    return modelCache[team]
  }

  // Start parsing all three models during scene setup, before any captures occur.
  ;(['player', 'enemy', 'neutral'] as Team[]).forEach(getModelPrototype)

  const drawLabel = (node: Node) => {
    const context = node.texture.getContext() as unknown as CanvasRenderingContext2D
    context.clearRect(0, 0, 256, 96)
    context.textAlign = 'center'
    context.font = '700 44px Arial'
    context.fillStyle = '#ffffff'
    context.shadowColor = '#000000'
    context.shadowBlur = 8
    context.fillText(`${Math.floor(node.energy)} / ${node.maxEnergy}`, 128, 59)
    node.texture.update()
  }

  const recolor = (node: Node) => {
    node.visual?.dispose()
    node.visual = undefined
    node.shell.material?.dispose()
    node.shell.material = makeMaterial(scene, `shell-${node.id}`, COLORS[node.team], 0.04)
    node.motes.forEach((mote, index) => {
      mote.material?.dispose()
      mote.material = makeMaterial(scene, `strength-mote-mat-${node.id}-${index}`, COLORS[node.team], 0.9)
    })
    const expectedTeam = node.team
    getModelPrototype(expectedTeam).then(prototype => {
      if (disposed || node.team !== expectedTeam) return
      const visual = prototype.clone(`energy-ball-${node.id}`, null, false)!
      visual.setEnabled(true)
      visual.parent = node.root
      visual.position.setAll(0)
      visual.getChildMeshes(false).forEach(mesh => {
        mesh.isPickable = false
        mesh.metadata = { nodeIndex: Number(node.id) }
        if (expectedTeam === 'neutral' && mesh.material) {
          mesh.material = mesh.material.clone(`neutral-node-mat-${node.id}-${mesh.name}`)
        }
      })
      visual.metadata = { nodeIndex: Number(node.id) }
      node.visual = visual
      if (expectedTeam === 'neutral') updateNeutralTint(node)
    })
    drawLabel(node)
  }

  level.forEach((data, index) => {
    const root = BABYLON.MeshBuilder.CreateSphere(`node-${index}`, { diameter: 2.35, segments: 24 }, scene)
    root.position.set(data.x, data.y, data.z)
    root.visibility = 0
    root.metadata = { nodeIndex: index }

    const shell = BABYLON.MeshBuilder.CreateSphere(`shell-${index}`, { diameter: 2.35, segments: 24 }, scene)
    shell.parent = root
    shell.metadata = { nodeIndex: index }
    shell.visibility = 0.12

    const motes = Array.from({ length: 6 }, (_, moteIndex) => {
      const mote = BABYLON.MeshBuilder.CreateSphere(`strength-mote-${index}-${moteIndex}`, { diameter: 0.11, segments: 6 }, scene)
      mote.parent = root
      mote.material = makeMaterial(scene, `strength-mote-mat-${index}-${moteIndex}`, COLORS[data.team], 0.9)
      mote.isPickable = false
      mote.visibility = 0
      return mote
    })

    const selectionHalo = BABYLON.MeshBuilder.CreateTorus(`selection-halo-${index}`, { diameter: 2.85, thickness: 0.055, tessellation: 72 }, scene)
    selectionHalo.parent = root
    selectionHalo.rotation.x = Math.PI / 2
    selectionHalo.material = makeMaterial(scene, `selection-halo-mat-${index}`, COLORS.player, 0.9)
    selectionHalo.isPickable = false
    selectionHalo.visibility = 0

    const selectionHaloOuter = BABYLON.MeshBuilder.CreateTorus(`selection-halo-outer-${index}`, { diameter: 3.25, thickness: 0.04, tessellation: 72 }, scene)
    selectionHaloOuter.parent = root
    selectionHaloOuter.rotation.x = Math.PI / 3
    selectionHaloOuter.rotation.y = Math.PI / 4
    selectionHaloOuter.material = makeMaterial(scene, `selection-halo-outer-mat-${index}`, BABYLON.Color3.FromHexString('#9ffff0'), 0.72)
    selectionHaloOuter.isPickable = false
    selectionHaloOuter.visibility = 0

    const texture = new BABYLON.DynamicTexture(`label-${index}`, { width: 256, height: 96 }, scene, false)
    texture.hasAlpha = true
    const labelMat = new BABYLON.StandardMaterial(`label-mat-${index}`, scene)
    labelMat.diffuseTexture = texture
    labelMat.emissiveTexture = texture
    labelMat.opacityTexture = texture
    labelMat.disableLighting = true
    const label = BABYLON.MeshBuilder.CreatePlane(`label-plane-${index}`, { width: 2.25, height: 0.84 }, scene)
    label.parent = root
    label.position.y = 1.75
    label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL
    label.material = labelMat
    label.isPickable = false

    const node: Node = {
      id: String(index), team: data.team, energy: data.energy, maxEnergy: data.max,
      neutralInfluence: 0, neutralResistance: data.energy,
      position: root.position, root, shell, motes, selectionHalo, selectionHaloOuter, selectionFade: 0, outputCursor: 0, fireCooldown: 0, orbitPhase: Math.random() * Math.PI * 2, label, texture,
    }
    nodes.push(node)
    recolor(node)
  })

  const snapshot = () => {
    const state: GameSnapshot = {
      playerNodes: nodes.filter(n => n.team === 'player').length,
      enemyNodes: nodes.filter(n => n.team === 'enemy').length,
      neutralNodes: nodes.filter(n => n.team === 'neutral').length,
      status,
      selected: Boolean(selected),
    }
    onUpdate?.(state)
  }

  const stopLink = (link: Link) => {
    link.firing = false
    if (link.units.length === 0) links.delete(link.key)
  }

  const curveBetween = (from: Node, to: Node) => {
    const start = from.position.clone()
    const end = to.position.clone()
    const middle = BABYLON.Vector3.Center(start, end)
    middle.y += 0.8 + BABYLON.Vector3.Distance(start, end) * 0.08
    return BABYLON.Curve3.CreateQuadraticBezier(start, middle, end, 18).getPoints()
  }

  const startLink = (from: Node, to: Node) => {
    const key = `${from.id}>${to.id}`
    const existing = links.get(key)
    if (existing?.firing) return
    const outgoing = Array.from(links.values()).filter(link => link.from === from && link.firing)
    if (outgoing.length >= 2) stopLink(outgoing[0])
    const path = curveBetween(from, to)
    if (existing) {
      existing.firing = true
    } else {
      links.set(key, { key, from, to, units: [], firing: true, path })
    }
  }

  const toggleLink = (from: Node, to: Node) => {
    const existing = links.get(`${from.id}>${to.id}`)
    if (existing?.firing) stopLink(existing)
    else startLink(from, to)
  }

  const deselect = () => {
    selected = null
    snapshot()
  }

  const captureBurst = (node: Node, team: Exclude<Team, 'neutral'>) => {
    const wave = BABYLON.MeshBuilder.CreateSphere(`capture-wave-${node.id}`, { diameter: 2.4, segments: 16 }, scene)
    wave.position.copyFrom(node.position)
    wave.material = captureWaveMaterials[team]
    wave.isPickable = false
    const particles = Array.from({ length: 12 }, (_, index) => {
      const mote = BABYLON.MeshBuilder.CreateSphere(`capture-mote-${index}`, { diameter: 0.1, segments: 5 }, scene)
      mote.position.copyFrom(node.position)
      mote.material = captureMoteMaterials[team]
      mote.metadata = { velocity: new BABYLON.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().scale(2.2 + Math.random() * 2) }
      mote.isPickable = false
      return mote
    })
    let life = 0
    const observer = scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000
      life += dt
      wave.scaling.setAll(1 + life * 2.5)
      wave.visibility = Math.max(0, 1 - life * 1.8)
      particles.forEach(mote => {
        mote.position.addInPlace(mote.metadata.velocity.scale(dt))
        mote.visibility = Math.max(0, 1 - life * 1.5)
      })
      if (life > 0.7) {
        scene.onBeforeRenderObservable.remove(observer)
        wave.dispose()
        particles.forEach(mote => mote.dispose())
      }
    })
  }

  const capture = (node: Node, team: Exclude<Team, 'neutral'>) => {
    node.team = team
    node.energy = 7
    recolor(node)
    captureBurst(node, team)
    ;Array.from(links.values()).filter(link => link.from === node).forEach(stopLink)
    snapshot()
  }

  const createUnitPath = (link: Link) => {
    const start = link.from.position.clone()
    const end = link.to.position.clone()
    const direction = end.subtract(start).normalize()
    let sideways = BABYLON.Vector3.Cross(direction, new BABYLON.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5))
    if (sideways.lengthSquared() < 0.01) sideways = BABYLON.Vector3.Cross(direction, BABYLON.Axis.Y)
    sideways.normalize()
    const secondAxis = BABYLON.Vector3.Cross(direction, sideways).normalize()
    const distance = BABYLON.Vector3.Distance(start, end)
    const middle = BABYLON.Vector3.Center(start, end)
      .add(sideways.scale((Math.random() - 0.5) * Math.min(4, distance * 0.35)))
      .add(secondAxis.scale((Math.random() - 0.5) * Math.min(3, distance * 0.25)))
    return BABYLON.Curve3.CreateQuadraticBezier(start, middle, end, 24).getPoints()
  }

  const launchUnit = (link: Link) => {
    const mesh = BABYLON.MeshBuilder.CreateSphere(`unit-${link.key}-${elapsed}`, { diameter: 0.42, segments: 12 }, scene)
    const path = createUnitPath(link)
    const pathLength = path.slice(1).reduce((total, point, index) => total + BABYLON.Vector3.Distance(path[index], point), 0)
    mesh.position.copyFrom(path[0])
    mesh.material = projectileMaterials[link.from.team as CombatTeam]
    mesh.isPickable = false
    mesh.computeWorldMatrix(true)
    const trail = new BABYLON.TrailMesh(`unit-trail-${link.key}-${elapsed}`, mesh, scene, 0.18, 30, true)
    trail.material = trailMaterials[link.from.team as CombatTeam]
    trail.isPickable = false
    trail.visibility = 0
    link.units.push({ mesh, trail, path, pathLength, progress: 0, team: link.from.team as Exclude<Team, 'neutral'> })
  }

  const forwardOverflow = (node: Node) => {
    const outputs = Array.from(links.values()).filter(link => link.from === node && link.firing)
    if (outputs.length === 0) return
    const output = outputs[node.outputCursor % outputs.length]
    node.outputCursor = (node.outputCursor + 1) % outputs.length
    launchUnit(output)
  }

  const createImpact = (link: Link, team: Exclude<Team, 'neutral'>, position: BABYLON.Vector3) => {
    const impact = BABYLON.MeshBuilder.CreateSphere(`impact-${link.key}-${elapsed}`, { diameter: 0.28, segments: 8 }, scene)
    impact.position.copyFrom(position)
    impact.material = impactMaterials[team]
    impact.isPickable = false

    const frameRate = 60
    const scaleAnimation = new BABYLON.Animation('impact-scale', 'scaling', frameRate, BABYLON.Animation.ANIMATIONTYPE_VECTOR3)
    scaleAnimation.setKeys([
      { frame: 0, value: new BABYLON.Vector3(0.45, 0.45, 0.45) },
      { frame: 4, value: new BABYLON.Vector3(1.35, 1.35, 1.35) },
      { frame: 11, value: new BABYLON.Vector3(2.1, 2.1, 2.1) },
    ])
    const fadeAnimation = new BABYLON.Animation('impact-fade', 'visibility', frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT)
    fadeAnimation.setKeys([
      { frame: 0, value: 1 },
      { frame: 4, value: 0.85 },
      { frame: 11, value: 0 },
    ])
    impact.animations = [scaleAnimation, fadeAnimation]
    scene.beginAnimation(impact, 0, 11, false, 1, () => impact.dispose())
  }

  function updateNeutralTint(node: Node) {
    if (node.team !== 'neutral') return
    const progress = Math.min(1, Math.abs(node.neutralInfluence) / node.neutralResistance)
    const leadingTeam = node.neutralInfluence >= 0 ? 'player' : 'enemy'
    const color = BABYLON.Color3.Lerp(COLORS.neutral, COLORS[leadingTeam], progress)
    const shellMaterial = node.shell.material as BABYLON.StandardMaterial
    shellMaterial.diffuseColor = color.scale(0.32)
    shellMaterial.emissiveColor = color
    shellMaterial.specularColor = color
    node.motes.forEach(mote => {
      const material = mote.material as BABYLON.StandardMaterial
      material.diffuseColor = color.scale(0.32)
      material.emissiveColor = color
      material.specularColor = color
    })
    node.visual?.getChildMeshes(false).forEach(mesh => {
      const material = mesh.material
      if (material instanceof BABYLON.PBRMaterial) {
        material.albedoColor = color.scale(0.42)
        material.emissiveColor = color.scale(0.75)
      } else if (material instanceof BABYLON.StandardMaterial) {
        material.diffuseColor = color.scale(0.42)
        material.emissiveColor = color.scale(0.75)
      }
    })
  }

  const deliver = (link: Link, team: Exclude<Team, 'neutral'>, impactPosition: BABYLON.Vector3) => {
    createImpact(link, team, impactPosition)
    const target = link.to
    if (target.team === team) {
      if (target.energy >= target.maxEnergy - 0.001) {
        forwardOverflow(target)
      } else {
        target.energy = Math.min(target.maxEnergy, target.energy + 1)
      }
    } else if (target.team === 'neutral') {
      // Neutral capture is a tug-of-war: cyan adds influence and pink removes it.
      // Opposing hits cancel prior progress instead of independently damaging the node.
      target.neutralInfluence += team === 'player' ? 1 : -1
      target.energy = Math.max(0, target.neutralResistance - Math.abs(target.neutralInfluence))
      updateNeutralTint(target)
      if (target.neutralInfluence >= target.neutralResistance) capture(target, 'player')
      else if (target.neutralInfluence <= -target.neutralResistance) capture(target, 'enemy')
    } else {
      target.energy -= 1
      if (target.energy <= 0) capture(target, team)
    }
  }

  const applyAction = (side: BotSide, action: BotAction) => {
    if (!action || !['send', 'stop'].includes(action.type) || action.from === action.to) return
    const from = nodes.find(node => node.id === String(action.from))
    const to = nodes.find(node => node.id === String(action.to))
    if (!from || !to || from.team !== side) return
    const existing = links.get(`${from.id}>${to.id}`)
    if (action.type === 'stop') {
      if (existing?.firing) stopLink(existing)
    } else startLink(from, to)
  }

  const chooseDefaultMove = (side: BotSide) => {
    const sources = nodes.filter(node => node.team === side && node.energy > 20)
      .sort((a, b) => b.energy - a.energy)
    const source = sources[0]
    if (!source) return
    const targets = nodes.filter(node => node.team !== side)
      .sort((a, b) => {
        const score = (node: Node) => BABYLON.Vector3.Distance(source.position, node.position) + node.energy * 0.09
        return score(a) - score(b)
      })
    if (targets[0]) startLink(source, targets[0])
  }

  const createBotState = (side: BotSide): BotState => ({
    side,
    time: elapsed,
    nodes: nodes.map(node => ({
      id: node.id,
      team: node.team,
      energy: node.energy,
      maxEnergy: node.maxEnergy,
      neutralInfluence: node.neutralInfluence,
      position: { x: node.position.x, y: node.position.y, z: node.position.z },
    })),
    links: Array.from(links.values()).map(link => ({ from: link.from.id, to: link.to.id, active: link.firing })),
  })

  const runControllerTurns = async () => {
    if (status !== 'playing' || botDecisionPending) return
    botDecisionPending = true
    try {
      for (const side of ['player', 'enemy'] as BotSide[]) {
        const controller = controllers[side]
        if (controller.kind === 'default') chooseDefaultMove(side)
        if (controller.kind === 'bot') {
          const actions = await botRuntimes[side]?.decide(createBotState(side)) || []
          actions.forEach(action => applyAction(side, action))
        }
      }
    } catch (error) {
      console.error('[Bot] Controller turn failed:', error)
    } finally {
      botDecisionPending = false
    }
  }

  let hovered: Node | null = null
  scene.onPointerObservable.add(pointerInfo => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERMOVE) {
      const index = pointerInfo.pickInfo?.pickedMesh?.metadata?.nodeIndex
      hovered = typeof index === 'number' ? nodes[index] : null
      canvas.style.cursor = hovered ? 'pointer' : 'grab'
      return
    }
    if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERPICK || status !== 'playing') return
    const picked = pointerInfo.pickInfo?.pickedMesh
    const index = picked?.metadata?.nodeIndex
    if (typeof index !== 'number') {
      deselect()
      return
    }
    const node = nodes[index]
    if (!selected) {
      if (node.team === 'player' && controllers.player.kind === 'human') {
        selected = node
        snapshot()
      }
      return
    }
    if (node === selected) {
      deselect()
      return
    }
    toggleLink(selected, node)
    deselect()
  })

  snapshot()
  engine.runRenderLoop(() => {
    const realDt = Math.min(engine.getDeltaTime() / 1000, 0.05)
    const timeScale = Math.max(1, Math.min(30, options.getTimeScale?.() || 1))
    const dt = realDt * timeScale
    elapsed += dt
    aiTimer -= dt

    if (status === 'playing') {
      nodes.forEach((node, index) => {
        if (node.team !== 'neutral') node.energy = Math.min(node.maxEnergy, node.energy + dt * 0.3)
        const strength = Math.max(0, Math.min(1, node.energy / node.maxEnergy))
        const baseSize = 0.72 + Math.pow(strength, 0.72) * 0.5
        const hoverBoost = hovered === node ? 0.07 : 0
        const pulse = Math.sin(elapsed * (2 + strength * 3) + index) * (0.008 + strength * 0.022)
        const size = baseSize + hoverBoost
        node.root.scaling.setAll(size + pulse)
        node.shell.visibility = 0.025 + strength * 0.2 + Math.max(0, Math.sin(elapsed * 3 + index)) * strength * 0.06
        node.shell.scaling.setAll(0.98 + strength * 0.35 + Math.sin(elapsed * 2.6 + index) * 0.025)
        const selectionTarget = selected === node ? 1 : 0
        const selectionDelta = selectionTarget - node.selectionFade
        const selectionStep = Math.min(Math.abs(selectionDelta), dt / 0.12)
        node.selectionFade += Math.sign(selectionDelta) * selectionStep
        if (node.selectionFade > 0.001) {
          const easedFade = node.selectionFade * node.selectionFade * (3 - 2 * node.selectionFade)
          node.selectionHalo.rotation.z += dt * 0.65
          node.selectionHalo.scaling.setAll(0.92 + easedFade * 0.08 + Math.sin(elapsed * 4) * 0.045 * easedFade)
          node.selectionHalo.visibility = (0.72 + Math.sin(elapsed * 4) * 0.18) * easedFade
          node.selectionHaloOuter.rotation.z -= dt * 0.5
          node.selectionHaloOuter.rotation.y += dt * 0.28
          node.selectionHaloOuter.scaling.setAll(0.92 + easedFade * 0.08 + Math.sin(elapsed * 4 + Math.PI) * 0.035 * easedFade)
          node.selectionHaloOuter.visibility = (0.58 + Math.sin(elapsed * 4 + Math.PI) * 0.14) * easedFade
        } else {
          node.selectionFade = 0
          node.selectionHalo.visibility = 0
          node.selectionHaloOuter.visibility = 0
        }
        if (node.visual) node.visual.rotation.y += dt * (0.12 + strength * 0.45)
        node.orbitPhase += dt * (0.65 + strength * 0.9)
        node.motes.forEach((mote, moteIndex) => {
          const threshold = (moteIndex + 1) / (node.motes.length + 1)
          mote.visibility = strength >= threshold ? Math.min(1, (strength - threshold) * 7) : 0
          const angle = node.orbitPhase + moteIndex * Math.PI * 2 / node.motes.length
          const radius = 1.25 + strength * 0.45 + (moteIndex % 2) * 0.13
          mote.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle * 1.35) * 0.52,
            Math.sin(angle) * radius,
          )
          mote.scaling.setAll(0.75 + strength * 0.65 + Math.sin(elapsed * 6 + moteIndex) * 0.12)
        })
        node.label.position.y = 1.75 + strength * 0.25 + Math.sin(elapsed * 1.6 + index) * 0.06
      })

      ;Array.from(links.values()).forEach(link => {
        link.units.slice().forEach(unit => {
          const projectileSpeed = 15
          unit.progress += dt * projectileSpeed / unit.pathLength
          const exactIndex = unit.progress * (unit.path.length - 1)
          const index = Math.min(unit.path.length - 2, Math.floor(exactIndex))
          const fraction = exactIndex - index
          unit.mesh.position.copyFrom(BABYLON.Vector3.Lerp(unit.path[index], unit.path[index + 1], fraction))
          unit.mesh.rotation.y += dt * 7
          if (unit.progress > 0.05) unit.trail.visibility = 1
          const toTarget = link.to.position.subtract(unit.mesh.position)
          const visibleBlobRadius = 0.66 * link.to.root.scaling.x
          const contactRadius = Math.max(0.55, visibleBlobRadius)
          const hasHitSurface = toTarget.length() <= contactRadius
          if (hasHitSurface || unit.progress >= 1) {
            const approach = unit.mesh.position.subtract(link.to.position).normalize()
            const impactPosition = link.to.position.add(approach.scale(contactRadius))
            unit.mesh.position.copyFrom(impactPosition)
            unit.trail.dispose()
            unit.mesh.dispose()
            link.units.splice(link.units.indexOf(unit), 1)
            deliver(link, unit.team, impactPosition)
            if (!link.firing && link.units.length === 0) links.delete(link.key)
          }
        })
      })

      nodes.forEach(node => {
        const outputs = Array.from(links.values()).filter(link => link.from === node && link.firing)
        if (outputs.length === 0 || node.team === 'neutral' || node.energy <= 0) {
          node.fireCooldown = 0
          return
        }
        node.fireCooldown += dt
        const fireInterval = getFireInterval(node)
        while (node.fireCooldown >= fireInterval) {
          node.fireCooldown -= fireInterval
          const output = outputs[node.outputCursor % outputs.length]
          node.outputCursor = (node.outputCursor + 1) % outputs.length
          launchUnit(output)
        }
      })

      if (aiTimer <= 0) {
        aiTimer = 1.25
        void runControllerTurns()
      }
      const playerCount = nodes.filter(node => node.team === 'player').length
      const enemyCount = nodes.filter(node => node.team === 'enemy').length
      if (enemyCount === 0) status = 'won'
      if (playerCount === 0) status = 'lost'
      if (status !== 'playing') {
        deselect()
        snapshot()
      }
      if (Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) nodes.forEach(drawLabel)
    }
    scene.render()
  })

  const resize = () => engine.resize()
  window.addEventListener('resize', resize)

  return () => {
    if (disposed) return
    disposed = true
    window.removeEventListener('resize', resize)
    Object.values(botRuntimes).forEach(runtime => runtime?.dispose())
    engine.stopRenderLoop()
    scene.dispose()
    engine.dispose()
  }
}

export default game
