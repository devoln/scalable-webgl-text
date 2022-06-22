const VertexRoughCode = `
#version 100

uniform mat3 WorldView;
attribute vec2 aPosition;

void main()
{
	gl_Position = vec4((WorldView * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const FragmentRoughCode = `
#version 100
precision highp float;

uniform vec4 Color; // used to select different channels for different samples

void main()
{
	gl_FragColor = Color;
}
`;

const VertexCurveCode = `
#version 100

uniform mat3 WorldView;
attribute vec4 aPositionST;
varying vec2 vST;

void main()
{
	vST = aPositionST.zw;
	gl_Position = vec4((WorldView * vec3(aPositionST.xy, 1.0)).xy, 0.0, 1.0);
}`;


const FragmentCurveCode = `
#version 100
precision highp float;
uniform vec4 Color; // used to select different channels for different samples
varying vec2 vST;

void main()
{
	if(vST.x * vST.x > vST.y) discard;
	gl_FragColor = Color;
}
`;

const VertexFinalizeCode = `
#version 100

attribute vec2 aPosition;

void main()
{
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FragmentFinalizeCode = `
#version 100
precision highp float;

uniform sampler2D GlyphTex;
uniform int Mode;

void main()
{
	vec2 coordStep = vec2(1.0 / 1024.0, 1.0 / 768.0);
	vec2 coord = gl_FragCoord.xy * coordStep;

	if(Mode == 0) // show the input texture as is
	{
		gl_FragColor = texture2D(GlyphTex, coord);
		return;
	}
	if(Mode == 1) // result without antialiasing
	{
		gl_FragColor = vec4(vec3(1.0 - mod(texture2D(GlyphTex, coord).y * 255.0, 2.0)), 1.0);
		return;
	}

	vec3 packed1 = texture2D(GlyphTex, coord).xyz * 255.0;
	vec2 packed2 = texture2D(GlyphTex, vec2(coord.x + coordStep.x, coord.y)).yz * 255.0;

	vec3 low1 = mod(packed1, 16.0);
	vec3 high1 = (packed1 - low1) * (1.0 / 16.0);
	vec2 low2 = mod(packed2, 16.0);
	vec2 high2 = (packed2 - low2) * (1.0 / 16.0);

	vec3 alpha1 = mod(high1, 2.0) + mod(low1, 2.0);
	vec2 alpha2 = mod(high2, 2.0) + mod(low2, 2.0);

	if(Mode == 2) // result with grayscale antialiasing
	{
		gl_FragColor = vec4(vec3(1.0 - (1.0 / 6.0) * (dot(alpha1, vec3(1.0)) + dot(alpha2, vec2(1.0)))), 1.0);
		return;
	}

	// subpixel antialiasing is done by the following formulas
	// R = (f(x - 2/3, y) + f(x - 1/3, y) + f(x, y)) / 3
	// G = (f(x - 1/3, y) + f(x, y) + f(x + 1/3, y)) / 3
	// B = (f(x, y) + f(x + 1/3, y) + f(x + 2/3, y)) / 3
	vec3 rgb = (1.0 / 6.0) * vec3(
		dot(alpha1, vec3(1.0)),
		alpha2.y + alpha1.x + alpha1.y,
		alpha2.x + alpha2.y + alpha1.x);

	gl_FragColor = vec4(1.0 - rgb, 1.0);
}
`;

let gRoughMesh;

class AccumPass
{
	constructor(gl)
	{
		this.gl = gl;

		this.accumTex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.accumTex);

		this.accumFbo = gl.createFramebuffer();
		
		this.rough = {};
		this.rough.prog = CompileShaderProgram(gl, VertexRoughCode, FragmentRoughCode);
		this.rough.aPositionLoc = gl.getAttribLocation(this.rough.prog, "aPosition");
		this.rough.colorLoc = gl.getUniformLocation(this.rough.prog, "Color");
		this.rough.worldViewLoc = gl.getUniformLocation(this.rough.prog, "WorldView");
		this.rough.vertexBuf = gl.createBuffer();
		this.rough.indexBuf = gl.createBuffer();
		this.rough.numIndices = 0;
		this.rough.show = true;
		
		this.curve = {};
		this.curve.vertexBuf = gl.createBuffer();
		this.curve.prog = CompileShaderProgram(gl, VertexCurveCode, FragmentCurveCode);
		this.curve.aPositionSTLoc = gl.getAttribLocation(this.curve.prog, "aPositionST");
		this.curve.colorLoc = gl.getUniformLocation(this.curve.prog, "Color");
		this.curve.worldViewLoc = gl.getUniformLocation(this.curve.prog, "WorldView");
		this.curve.numVertices = 0;
		this.curve.show = true;

		this.worldView = new Float32Array(9);
		this.worldViewForSamples = [];
		this.colorsForSamples = [];

		this.font = null;
		this.text = "";
	}

	async Init()
	{
		const fontURL = "fonts/Ubuntu/Ubuntu-RI.ttf";
		let ttfBuffer = await fetch(fontURL).then(res => res.arrayBuffer());
		this.font = opentype.parse(ttfBuffer);
	}

	OnCanvasResize(newWidth, newHeight)
	{
		this.worldView = new Float32Array([
			2 / newWidth,  0,               0,
			0,             -2 / newHeight,  0,
			-1,             1,              1
		]);
		this.worldViewForSamples = [];
		const sampleYOffsets = [-5, 1, -1, 5, -3, 3];
		const coeffX = 1.0 / (newWidth * 12);
		const coeffY = 1.0 / (newHeight * 12);
		for(let i = 0; i < 6; i++)
		{
			let m = new Float32Array(this.worldView);
			m[6] += (i*2 - 1) * coeffX;
			m[7] -= sampleYOffsets[i] * coeffY;
			this.worldViewForSamples[i] = m;
			let color = [0, 0, 0, 0];
			color[i >> 1] = (i & 1)? 16.0 / 255.0: 1.0 / 255.0;
			this.colorsForSamples[i] = color;
		}

		const gl = this.gl;

		gl.bindTexture(gl.TEXTURE_2D, this.accumTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, newWidth, newHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accumTex, 0);
		if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
			console.error("framebuffer is incomplete: " + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
	}

	SetText(str)
	{
		if(!this.font || this.text === str) return;
		const fontSizes = [150, 72, 54, 48, 40, 32, 24, 16, 12];
		let roughMesh = new TriangleFanBuilder();
		let curveMesh = new TriangleListBuilder();
		let y = fontSizes[0];
		for(let fs = 0; fs < fontSizes.length; fs++)
		{
			const fontSize = fontSizes[fs];
			const path = this.font.getPath(str, 10, y, fontSize);
			const cmds = path.commands;
			let prevPoint, curPoint;
			for(let i = 0; i < cmds.length; i++, prevPoint = curPoint)
			{
				const cmd = cmds[i];
				if(cmd.type === 'Z') continue;
				curPoint = [cmd.x, cmd.y];
				if(cmd.type === 'M')
				{
					roughMesh.Restart(curPoint, curPoint);
					continue;
				}
				roughMesh.NextTriangle(curPoint);
				if(cmd.type === 'L') continue;
				if(cmd.type === 'Q')
				{
					const controlPoint = [cmd.x1, cmd.y1];
					curveMesh.AddTriangle(prevPoint.concat([0, 0]), controlPoint.concat([0.5, 0]), curPoint.concat([1, 1]));
					continue;
				}
				console.error("unexpected command type " + cmd.type);
			}
			y += (fontSize + 10);
		}
		this.rough.numIndices = roughMesh.NumIndices;
		this.curve.numVertices = curveMesh.NumVertices;

		const gl = this.gl;

		gRoughMesh = roughMesh;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.rough.vertexBuf);
		gl.bufferData(gl.ARRAY_BUFFER, roughMesh.VertexArray.buffer, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.rough.indexBuf);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, roughMesh.IndexArray.buffer, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.curve.vertexBuf);
		gl.bufferData(gl.ARRAY_BUFFER, curveMesh.VertexArray.buffer, gl.STATIC_DRAW);
	}

	Render()
	{
		const gl = this.gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo);
		gl.clearColor(0.0, 0.0, 0.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		
		if(this.rough.show)
		{
			gl.useProgram(this.rough.prog);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.rough.vertexBuf);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.rough.indexBuf);
			gl.vertexAttribPointer(this.rough.aPositionLoc, 2, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(0);
			for(let i = 0; i < this.worldViewForSamples.length; i++)
			{
				gl.uniform4fv(this.rough.colorLoc, this.colorsForSamples[i]);
				gl.uniformMatrix3fv(this.rough.worldViewLoc, false, this.worldViewForSamples[i]);
				gl.drawElements(gl.TRIANGLES, this.rough.numIndices, gl.UNSIGNED_SHORT, 0);
			}
		}
	
		if(this.curve.show)
		{
			gl.useProgram(this.curve.prog);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.curve.vertexBuf);
			gl.vertexAttribPointer(this.curve.aPositionSTLoc, 4, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(0);
			for(let i = 0; i < this.worldViewForSamples.length; i++)
			{
				gl.uniform4fv(this.curve.colorLoc, this.colorsForSamples[i]);
				gl.uniformMatrix3fv(this.curve.worldViewLoc, false, this.worldViewForSamples[i]);
				gl.drawArrays(gl.TRIANGLES, 0, this.curve.numVertices);
			}
		}
	}
}

class FinalPass
{
	constructor(gl)
	{
		this.gl = gl;

		this.prog = CompileShaderProgram(gl, VertexFinalizeCode, FragmentFinalizeCode);
		this.aPositionLoc = gl.getAttribLocation(this.prog, "aPosition");
		this.modeLoc = gl.getUniformLocation(this.prog, "Mode");

		this.vertexBuf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]).buffer, gl.STATIC_DRAW);
		this.mode = 3;
	}
	
	Render(accumTex)
	{
		const gl = this.gl;
		
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.enableVertexAttribArray(0);
		gl.clearColor(1.0, 1.0, 1.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
		gl.useProgram(this.prog);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuf);
		gl.vertexAttribPointer(this.aPositionLoc, 2, gl.FLOAT, false, 0, 0);
		gl.bindTexture(gl.TEXTURE_2D, accumTex);
		gl.uniform1i(this.modeLoc, this.mode);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
}

class Demo 
{
	constructor()
	{
		this.canvas = canvas;
		if(!this.canvas) alert("Could not initialize canvas.");
		try
		{
			this.gl = this.canvas.getContext("webgl", {antialias: false});
		}
		catch(e) {}
		const gl = this.gl;

		if(!gl) alert("Could not initialize WebGL.");
		gl.disable(gl.CULL_FACE);
		
		this.accumPass = new AccumPass(gl);
		this.finalPass = new FinalPass(gl);
		
		this.accumPass.Init();
		this.OnCanvasResize(this.canvas.width, this.canvas.height);
	}
	
	OnCanvasResize(newWidth, newHeight)
	{
		const gl = this.gl;
		gl.viewport(0, 0, newWidth, newHeight);
		this.accumPass.OnCanvasResize(newWidth, newHeight);
	}
	
	Step(dt)
	{
		this.accumPass.SetText(eText.value);
		this.accumPass.rough.show = eTriangles.checked;
		this.accumPass.curve.show = eCurves.checked;
		this.finalPass.mode = eShowOffscreenTex.checked? 0:
			eSubpixelSampling.checked? 3: eMultisampling.checked? 2: 1;
	}
	
	RenderFrame()
	{
		this.accumPass.Render();
		this.finalPass.Render(this.accumPass.accumTex);
	}
	
	MainLoop()
	{
		const now = new Date().getTime();
		const dt = now - (this.prevTime || now);
		this.prevTime = now;
		
		this.Step(dt/1000);
		this.RenderFrame();
		window.requestAnimationFrame(() => this.MainLoop());
	}
}
