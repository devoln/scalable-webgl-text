
function IsEmptyString(str)
{
	return str == "" || /^\s+$/.test(str);
}

function CompileShader(gl, code, type)
{
	let sh = gl.createShader(type);
	gl.shaderSource(sh, code);
	gl.compileShader(sh);
	let log = gl.getShaderInfoLog(sh);
	if(!IsEmptyString(log)) console.log(log);
	return sh;
}

function LinkShaderProgram(gl, vertexShaderId, fragmentShaderId)
{
	let prog = gl.createProgram();
	gl.attachShader(prog, vertexShaderId);
	gl.attachShader(prog, fragmentShaderId);
	gl.linkProgram(prog);
	gl.useProgram(prog);
	let log = gl.getProgramInfoLog(prog);
	if(!IsEmptyString(log)) console.log(log);
	return prog;
}

function CompileShaderProgram(gl, vertexCode, fragmentCode)
{
	return LinkShaderProgram(gl,
		CompileShader(gl, vertexCode, gl.VERTEX_SHADER),
		CompileShader(gl, fragmentCode, gl.FRAGMENT_SHADER));
}

class TriangleFanBuilder
{
	constructor()
	{
		this.mFanIndex = -1;
		this.mLastIndex = -1;
		this.mVertices = [];
		this.mIndices = [];
	}

	Restart(v0, v1)
	{
		this.mFanIndex = this.mVertices.length;
		this.mLastIndex = this.mFanIndex + 1;
		this.mVertices.push(v0);
		this.mVertices.push(v1);
	}

	NextTriangle(vnext)
	{
		const i = this.mVertices.length;
		this.mVertices.push(vnext);
		this.mIndices.push(this.mFanIndex, this.mLastIndex, i);
		this.mLastIndex = i;
	}

	get NumVertices() {return this.mVertices.length;}
	get NumIndices() {return this.mIndices.length;}

	get VertexArray() {return new Float32Array(this.mVertices.flat());}
	get IndexArray() {return new Uint16Array(this.mIndices);}
};

class TriangleListBuilder
{
	constructor()
	{
		this.mVertices = [];
	}

	AddTriangle(v0, v1, v2)
	{
		this.mVertices.push(v0, v1, v2);
	}

	get NumVertices() {return this.mVertices.length;}

	get VertexArray() {return new Float32Array(this.mVertices.flat());}
};
